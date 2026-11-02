import { INSTRUMENTS } from './instruments.js';
import { PPQ, BEAT, BAR, STEP, MIXER_SIZE } from '../constants.js';
import { patternLength, songLength, getPattern, currentPattern, clipLength, clipValid } from '../store.js';
import { getBuffer, loadBuffer } from '../samples.js';
import { getPlugin, paramValues, loadPluginModule, pluginReady, processorName, allPlugins } from '../plugins.js';
import { encodeWav } from '../wav.js';
import { faderGain, cutoffHz } from './levels.js';
import { osc3Instrument } from './osc3.js';
import { autoValue, targetParam, fxTarget } from '../automation.js';
import { bpmAt, nextTempoChange, tickToSec } from '../tempo.js';

export { faderGain, cutoffHz };

function impulse(ctx, seconds = 2.2, decay = 3) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const b = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return b;
}

// Three band EQ of a mixer insert: low shelf, peak, high shelf. Returns [in, out, bands].
const EQ_BANDS = [
  ['lowshelf', 120],
  ['peaking', 1000],
  ['highshelf', 6000],
];
function makeEq(ctx) {
  const bands = EQ_BANDS.map(([type, f]) => {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    if (type === 'peaking') b.Q.value = 0.8;
    b.gain.value = 0;
    return b;
  });
  bands[0].connect(bands[1]);
  bands[1].connect(bands[2]);
  return bands;
}

export function createGraph(ctx, dest) {
  const G = { ctx, channels: new Map(), inserts: [], pluginNodes: new Map(), pluginEvents: new Map(), noteId: 0, transport: { bpm: 120, playing: false, position: 0, at: 0 }, duckers: [], fxHold: new Map(), fxTimers: new Set(), autoHold: new Set(), autoStarted: new Set(), silent: new Set() };
  const masterIn = ctx.createGain();
  const masterPan = ctx.createStereoPanner();
  const masterVol = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  const masterAn = ctx.createAnalyser();
  masterAn.fftSize = 1024;
  const masterEq = makeEq(ctx);
  masterIn.connect(masterEq[0]);
  masterEq[2].connect(masterPan);
  masterPan.connect(masterVol);
  masterVol.connect(limiter);
  limiter.connect(dest);
  limiter.connect(masterAn);
  G.inserts[0] = { in: masterIn, eq: masterEq, pan: masterPan, vol: masterVol, an: masterAn, fxSig: '', fxNodes: [] };

  const rev = ctx.createConvolver();
  rev.buffer = impulse(ctx);
  const revOut = ctx.createGain();
  revOut.gain.value = 0.6;
  rev.connect(revOut);
  revOut.connect(masterIn);

  const del = ctx.createDelay(2);
  const fb = ctx.createGain();
  fb.gain.value = 0.35;
  const dlp = ctx.createBiquadFilter();
  dlp.type = 'lowpass';
  dlp.frequency.value = 3500;
  del.connect(dlp);
  dlp.connect(fb);
  fb.connect(del);
  const delOut = ctx.createGain();
  delOut.gain.value = 0.5;
  dlp.connect(delOut);
  delOut.connect(masterIn);
  G.delay = del;

  for (let i = 1; i < MIXER_SIZE; i++) {
    const inp = ctx.createGain();
    const pan = ctx.createStereoPanner();
    const vol = ctx.createGain();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    const sr = ctx.createGain();
    const sd = ctx.createGain();
    sr.gain.value = 0;
    sd.gain.value = 0;
    const eq = makeEq(ctx);
    inp.connect(eq[0]);
    eq[2].connect(pan);
    pan.connect(vol);
    vol.connect(masterIn);
    vol.connect(an);
    vol.connect(sr);
    sr.connect(rev);
    vol.connect(sd);
    sd.connect(del);
    G.inserts[i] = { in: inp, eq, pan, vol, an, sr, sd, dest: masterIn, fxSig: '', fxNodes: [] };
  }
  return G;
}

function setParam(G, param, v, smooth) {
  if (smooth) param.setTargetAtTime(v, G.ctx.currentTime, 0.015);
  else param.value = v;
}

// Effects of an insert: in -> fx 1 -> fx 2 ... -> eq -> pan. Rebuilt when the slots change.
// Built in effects are native nodes, effect plugins are AudioWorklet nodes.
function syncEffects(G, ins, m, bpm) {
  const slots = (m.fx || []).filter((f) => f && f.on !== false).map((f) => ({ f, p: getPlugin(f.plugin) })).filter((x) => x.p && x.p.type === 'effect');
  const ready = slots.filter((x) => {
    if (pluginReady(G.ctx, x.p)) return true;
    loadPluginModule(G.ctx, x.p).then((ok) => ok && G.onModuleLoaded && G.onModuleLoaded());
    return false;
  });
  const sig = ready.map((x) => processorName(x.p)).join('|');
  if (sig !== ins.fxSig) {
    ins.in.disconnect();
    for (const e of ins.fxNodes || []) e.output.disconnect();
    ins.fxNodes = ready.map((x) => {
      const params = paramValues(x.p, x.f.params);
      if (x.p.builtin) {
        const fx = x.p.create(G.ctx, params);
        fx.set(params, bpm);
        return { fx, input: fx.input, output: fx.output, slot: x.f, params: JSON.stringify(params) + (x.p.tempo ? bpm : '') };
      }
      const node = new AudioWorkletNode(G.ctx, processorName(x.p), { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { params, transport: G.transport } });
      node.port.onmessage = (e) => {
        if (e.data && e.data.type === 'error' && G.onPluginError) G.onPluginError(x.p, e.data.message);
      };
      return { node, input: node, output: node, slot: x.f, params: JSON.stringify(params) };
    });
    let prev = ins.in;
    for (const e of ins.fxNodes) {
      prev.connect(e.input);
      prev = e.output;
    }
    prev.connect(ins.eq[0]);
    ins.fxSig = sig;
  } else {
    // Same chain: only push parameter changes.
    ins.fxNodes.forEach((e, i) => {
      const x = ready[i];
      const values = { ...paramValues(x.p, x.f.params), ...(G.fxHold.get(x.f) || {}) };
      const json = JSON.stringify(values) + (x.p.tempo ? bpm : '');
      if (json !== e.params) {
        e.params = json;
        if (e.fx) e.fx.set(values, bpm);
        else e.node.port.postMessage({ type: 'params', values });
      }
      e.slot = x.f;
    });
  }
}

// Tell every plugin node the tempo and play state.
export function pushTransport(G, t) {
  G.transport = t;
  const msg = { type: 'transport', ...t };
  for (const e of G.pluginNodes.values()) e.node.port.postMessage(msg);
  for (const ins of G.inserts) for (const e of ins.fxNodes || []) if (e.node) e.node.port.postMessage(msg);
}

export function syncGraph(G, project, smooth) {
  const mx = project.mixer;
  const anySolo = mx.some((m, i) => i > 0 && m.solo);
  // Parameters driven by an automation clip are left to it while the song plays.
  const held = (key) => G.autoHold.has(key);
  G.silent.clear();
  mx.forEach((m, i) => {
    const ins = G.inserts[i];
    if (!ins) return;
    syncEffects(G, ins, m, project.bpm);
    const muted = m.mute || (i > 0 && anySolo && !m.solo);
    const k = 'mixer:' + i + ':';
    if (muted) {
      G.silent.add(k + 'vol');
      setParam(G, ins.vol.gain, 0, smooth);
    } else if (!held(k + 'vol')) setParam(G, ins.vol.gain, faderGain(m.vol), smooth);
    if (!held(k + 'pan')) setParam(G, ins.pan.pan, m.pan, smooth);
    const eq = m.eq || [0, 0, 0];
    ins.eq.forEach((b, j) => { if (!held(k + 'eq' + j)) setParam(G, b.gain, eq[j] || 0, smooth); });
    if (i > 0) {
      if (!held(k + 'reverb')) setParam(G, ins.sr.gain, m.reverb, smooth);
      if (!held(k + 'delay')) setParam(G, ins.sd.gain, m.delay, smooth);
      // Routing: an insert sends to the master or to a higher numbered insert (a bus).
      const dest = (m.route > i && G.inserts[m.route]) ? G.inserts[m.route].in : G.inserts[0].in;
      if (ins.dest !== dest) {
        ins.vol.disconnect(ins.dest);
        ins.vol.connect(dest);
        ins.dest = dest;
      }
    }
  });
  G.duckers = [];
  for (const ins of G.inserts) for (const e of ins.fxNodes || []) if (e.fx && e.fx.duck && e.slot.source) G.duckers.push({ source: e.slot.source, fx: e.fx });
  setParam(G, G.delay.delayTime, Math.min(2, (60 / project.bpm) * 0.75), smooth);

  const seen = new Set();
  for (const c of project.channels) {
    seen.add(c.id);
    let ch = G.channels.get(c.id);
    if (!ch) {
      ch = { in: G.ctx.createGain(), filt: G.ctx.createBiquadFilter(), pan: G.ctx.createStereoPanner(), insert: -1 };
      ch.filt.type = 'lowpass';
      ch.in.connect(ch.filt);
      ch.filt.connect(ch.pan);
      G.channels.set(c.id, ch);
    }
    if (ch.insert !== c.insert) {
      ch.pan.disconnect();
      ch.pan.connect((G.inserts[c.insert] || G.inserts[0]).in);
      ch.insert = c.insert;
    }
    const k = 'channel:' + c.id + ':';
    if (c.mute) {
      G.silent.add(k + 'vol');
      setParam(G, ch.in.gain, 0, smooth);
    } else if (!held(k + 'vol')) setParam(G, ch.in.gain, c.vol, smooth);
    if (!held(k + 'pan')) setParam(G, ch.pan.pan, c.pan, smooth);
    if (!held(k + 'cutoff')) setParam(G, ch.filt.frequency, cutoffHz(c.params.cutoff), smooth);
    if (!held(k + 'reso')) setParam(G, ch.filt.Q, 0.7 + c.params.reso * 14, smooth);
  }
  for (const [id, ch] of G.channels) {
    if (!seen.has(id) && !id.startsWith('__preview_')) {
      ch.pan.disconnect();
      G.channels.delete(id);
    }
  }
  // Plugin nodes: drop the ones whose channel is gone or changed instrument, push parameter changes.
  for (const [id, entry] of G.pluginNodes) {
    const c = project.channels.find((x) => x.id === id) || (id.startsWith('__preview_') ? { instrument: entry.instrument } : null);
    const plugin = c && c.instrument && c.instrument.startsWith('plugin:') ? getPlugin(c.instrument.slice(7)) : null;
    if (!plugin || processorName(plugin) !== entry.name) {
      entry.node.disconnect();
      G.pluginNodes.delete(id);
      continue;
    }
    const values = paramValues(plugin, c.pluginParams);
    const json = JSON.stringify(values);
    if (json !== entry.params) {
      entry.params = json;
      entry.node.port.postMessage({ type: 'params', values });
    }
  }
}

// Reversed copies of sample buffers, made once per buffer.
const reversed = new WeakMap();
export function reverseBuffer(ctx, buf) {
  let r = reversed.get(buf);
  if (r) return r;
  r = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c);
    const dst = r.getChannelData(c);
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
  }
  reversed.set(buf, r);
  return r;
}

// Glide: shift the pitch of every source from `cents` back to 0 over `time` seconds.
// A ConstantSource added to each detune param keeps the instrument's own detune.
function glide(ctx, sources, cents, t, time) {
  const params = sources.map((s) => s && s.detune).filter(Boolean);
  if (!params.length || !cents) return;
  const cs = ctx.createConstantSource();
  cs.offset.setValueAtTime(cents, t);
  cs.offset.linearRampToValueAtTime(0, t + Math.max(0.005, time));
  for (const prm of params) cs.connect(prm);
  cs.start(t);
  cs.stop(t + Math.max(0.005, time) + 0.05);
}

// Sample of a sampler note: key zones (multi sample instrument), slices or one sample.
function samplerSource(channel, key) {
  const p = channel.params;
  let sample = channel.sample;
  let root = 60;
  let a = p.start || 0;
  let b = p.end == null ? 1 : p.end;
  let rateKey = key;
  if (channel.zones && channel.zones.length) {
    let best = channel.zones[0];
    for (const z of channel.zones) if (Math.abs(z.key - key) < Math.abs(best.key - key)) best = z;
    sample = best.sample;
    root = best.key;
  }
  if (channel.slices && channel.slices.length) {
    const i = key - 60;
    if (i < 0 || i >= channel.slices.length) return null;
    a = channel.slices[i];
    b = i + 1 < channel.slices.length ? channel.slices[i + 1] : 1;
    rateKey = 60;
  }
  return { sample, root, a, b, rateKey };
}

// Start one note. dur = Infinity holds it until releaseVoice().
// Sampler: one shot by default, sustained while the note lasts when Loop is on.
function playSampler(G, channel, ch, t, key, vel, dur, fromKey) {
  const src = samplerSource(channel, key);
  if (!src) return null;
  let buf = src.sample ? getBuffer(src.sample) : null;
  if (!buf) {
    if (src.sample) loadBuffer(src.sample);
    return null;
  }
  const p = channel.params;
  if (p.reverse) buf = reverseBuffer(G.ctx, buf);
  if (src.b <= src.a) return null;
  const ctx = G.ctx;
  const vg = ctx.createGain();
  vg.connect(ch.in);
  const s = ctx.createBufferSource();
  s.buffer = buf;
  const rate = Math.pow(2, (src.rateKey + (p.pitch || 0) - src.root) / 12);
  s.playbackRate.value = rate;
  s.connect(vg);
  const off = src.a * buf.duration;
  const segEnd = src.b * buf.duration;
  const att = Math.max(0, p.attack || 0);
  const rel = Math.max(0.01, p.release || 0.02);
  const loop = !!p.loop;
  if (att > 0) {
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(vel, t + att);
  } else vg.gain.setValueAtTime(vel, t);
  let end;
  if (loop) {
    s.loop = true;
    s.loopStart = off;
    s.loopEnd = segEnd;
    if (Number.isFinite(dur)) {
      vg.gain.setTargetAtTime(0, t + dur, rel / 4);
      end = t + dur + rel * 1.6;
    } else end = Infinity;
  } else {
    end = t + (segEnd - off) / rate;
    if (Number.isFinite(dur) && p.release > 0 && t + dur < end) {
      // A release set on a one shot sample fades it when the note ends.
      vg.gain.setTargetAtTime(0, t + dur, rel / 4);
      end = Math.min(end, t + dur + rel * 1.6);
    }
  }
  s.start(t, off);
  if (Number.isFinite(end)) s.stop(end);
  if (fromKey != null) glide(ctx, [s], (fromKey - key) * 100, t, p.glide || 0.1);
  const voice = { vg, sources: [s], rel, end, oneShot: !loop };
  s.onended = () => {
    voice.ended = true;
    try {
      vg.disconnect();
    } catch {
      /* already disconnected */
    }
  };
  return voice;
}

// Audio clip of the playlist. offset: seconds already played in the clip,
// dur: seconds left to play, spt: seconds per tick, clipDur: full clip length in seconds.
// The clip has its own gain, pitch (resampling), fades and start offset.
export function playAudioClip(G, clip, t, offset, dur, spt = 0, clipDur = 0, insert = 0) {
  const buf = getBuffer(clip.sampleId);
  if (!buf) {
    loadBuffer(clip.sampleId);
    return null;
  }
  const rate = Math.pow(2, (clip.pitch || 0) / 12);
  const bufPos = (offset + (clip.offset || 0) * spt) * rate;
  if (bufPos >= buf.duration) return null;
  const ctx = G.ctx;
  const gain = clip.gain == null ? 0.8 : 0.8 * clip.gain;
  const vg = ctx.createGain();
  vg.connect((G.inserts[insert] || G.inserts[0]).in);
  const s = ctx.createBufferSource();
  s.buffer = clip.reverse ? reverseBuffer(ctx, buf) : buf;
  s.playbackRate.value = rate;
  s.connect(vg);
  const end = t + Math.min(dur, (buf.duration - bufPos) / rate);
  const fi = (clip.fadeIn || 0) * spt;
  const fo = (clip.fadeOut || 0) * spt;
  const level = (x) => gain * Math.min(1, fi > 0 ? x / fi : 1, fo > 0 && clipDur ? Math.max(0, clipDur - x) / fo : 1);
  vg.gain.setValueAtTime(level(offset), t);
  if (fi > 0 && offset < fi) vg.gain.linearRampToValueAtTime(gain, t + (fi - offset));
  if (fo > 0 && clipDur) {
    const foStart = clipDur - fo - offset;
    if (foStart > 0) vg.gain.setValueAtTime(gain, t + foStart);
    vg.gain.linearRampToValueAtTime(0, t + clipDur - offset);
  }
  s.start(t, bufPos);
  s.stop(end);
  const voice = { vg, sources: [s], rel: 0.02, end, oneShot: true };
  s.onended = () => {
    voice.ended = true;
    try {
      vg.disconnect();
    } catch {
      /* already disconnected */
    }
  };
  return voice;
}

// Worklet node that runs a code plugin for one channel.
function pluginNode(G, channel, ch) {
  const plugin = getPlugin(channel.instrument.slice(7));
  if (!plugin) return null;
  const name = processorName(plugin);
  let entry = G.pluginNodes.get(channel.id);
  if (entry && entry.name === name) return entry.node;
  if (!pluginReady(G.ctx, plugin)) {
    loadPluginModule(G.ctx, plugin);
    return null;
  }
  if (entry) entry.node.disconnect();
  const params = paramValues(plugin, channel.pluginParams);
  const node = new AudioWorkletNode(G.ctx, name, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { params, transport: G.transport } });
  node.port.onmessage = (e) => {
    if (e.data && e.data.type === 'error' && G.onPluginError) G.onPluginError(plugin, e.data.message);
  };
  node.connect(ch.in);
  entry = { node, name, instrument: channel.instrument, params: JSON.stringify(params) };
  G.pluginNodes.set(channel.id, entry);
  return node;
}

function playPlugin(G, channel, ch, t, key, vel, dur) {
  const k = key + (channel.params.pitch || 0);
  const ev = { type: 'note', id: ++G.noteId, frame: Math.round(t * G.ctx.sampleRate), key: k, freq: 440 * Math.pow(2, (k - 69) / 12), vel, dur };
  if (G.offline) {
    // Offline export: events go to the node at creation, see renderWav.
    if (!G.pluginEvents.has(channel.id)) G.pluginEvents.set(channel.id, []);
    G.pluginEvents.get(channel.id).push(ev);
    return null;
  }
  const node = pluginNode(G, channel, ch);
  if (!node) return null;
  node.port.postMessage(ev);
  return { plugin: true, node, id: ev.id, end: Number.isFinite(dur) ? t + dur + 2 : Infinity };
}

export function playNote(G, channel, t, key, vel, dur, fromKey = null) {
  const ctx = G.ctx;
  const ch = G.channels.get(channel.id);
  if (!ch) return null;
  // Sidechain: notes of a source channel duck the inserts that listen to it.
  for (const d of G.duckers) if (d.source === channel.id && !channel.mute) d.fx.duck(t);
  if (channel.instrument === 'sampler') return playSampler(G, channel, ch, t, key, vel, dur, fromKey);
  if (channel.instrument.startsWith('plugin:')) return playPlugin(G, channel, ch, t, key, vel, dur);
  const inst = channel.instrument === 'osc3' ? osc3Instrument(channel) : INSTRUMENTS[channel.instrument] || INSTRUMENTS.piano;
  const p = channel.params;
  const f = 440 * Math.pow(2, (key + (p.pitch || 0) - 69) / 12);
  const vg = ctx.createGain();
  vg.connect(ch.in);
  const v = inst.play(ctx, vg, t, f, vel, dur);
  const rel = Math.max(inst.release || 0.05, p.release || 0);
  const off = Number.isFinite(dur) ? t + Math.max(dur, 0.005) : Infinity;
  const att = Math.max(0, p.attack || 0);
  if (!inst.oneShot) {
    if (att > 0) {
      const rampEnd = Math.min(t + att, off);
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(Math.min(1, (rampEnd - t) / att), rampEnd);
    }
    // Decay to the sustain level after the attack.
    const sus = p.sustain == null ? 1 : p.sustain;
    if (sus < 1 && t + att < off) {
      if (p.decay > 0) vg.gain.setTargetAtTime(sus, t + att, p.decay / 3);
      else vg.gain.setValueAtTime(sus, t + att);
    }
  }
  let end;
  if (inst.oneShot) end = t + v.length;
  else if (Number.isFinite(off)) {
    vg.gain.setTargetAtTime(0, off, rel / 4);
    end = off + rel * 1.6;
    if (v.length) end = Math.min(end, t + v.length);
  } else end = v.length ? t + v.length : Infinity;
  if (fromKey != null) glide(ctx, v.sources, (fromKey - key) * 100, t, p.glide || 0.1);
  const voice = { vg, sources: v.sources, rel, end, oneShot: !!inst.oneShot };
  if (Number.isFinite(end)) for (const s of v.sources) s.stop(end);
  if (v.sources[0]) {
    v.sources[0].onended = () => {
      voice.ended = true;
      try {
        vg.disconnect();
      } catch {
        /* already disconnected */
      }
    };
  }
  return voice;
}

export function releaseVoice(ctx, voice, fast = false) {
  if (!voice || voice.ended) return;
  if (voice.plugin) {
    voice.node.port.postMessage({ type: 'off', id: voice.id });
    voice.ended = true;
    return;
  }
  const now = ctx.currentTime;
  if (voice.end <= now) return;
  if (voice.oneShot && !fast) return;
  const g = voice.vg.gain;
  const rel = fast ? 0.01 : voice.rel;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.setTargetAtTime(0, now, rel / 4);
  const end = now + rel * 1.6 + 0.01;
  for (const s of voice.sources) s.stop(end);
  voice.end = end;
}

// Key a slide note glides from: the previous note of the same channel.
export function slideFrom(arr, n) {
  if (!n.slide || !arr) return null;
  let best = null;
  for (const x of arr) if (x !== n && x.t < n.t && (!best || x.t > best.t)) best = x;
  return best ? best.key : null;
}

// Calls cb(channel, note, tick, pattern) for every note starting in [from, to) of the loop,
// and onAudio(clip, tick) for every audio clip starting in that window.
export function collectEvents(project, mode, from, to, cb, onAudio) {
  const chans = new Map(project.channels.map((c) => [c.id, c]));
  if (mode === 'pattern') {
    const pat = currentPattern(project);
    for (const [cid, notes] of Object.entries(pat.notes)) {
      const c = chans.get(cid);
      if (!c) continue;
      for (const n of notes) if (n.t >= from && n.t < to) cb(c, n, n.t, pat);
    }
    return;
  }
  for (const clip of project.playlist.clips) {
    if (clip.type === 'auto') continue;
    const track = project.playlist.tracks[clip.track];
    if (track && track.mute) continue;
    const s = clip.start;
    if (clip.type === 'audio') {
      if (s >= from && s < to && onAudio && !clip.silent) onAudio(clip, s);
      continue;
    }
    const pat = getPattern(project, clip.patternId);
    if (!pat) continue;
    const L = patternLength(pat);
    const len = clipLength(project, clip);
    if (s >= to || s + len <= from) continue;
    // A stretched clip repeats its pattern; offset starts it inside the pattern.
    const origin = s - (clip.offset || 0);
    const k0 = Math.max(0, Math.floor((Math.max(from, s) - origin) / L));
    const k1 = Math.floor((Math.min(to, s + len) - origin) / L);
    for (let k = k0; k <= k1; k++) {
      const base = origin + k * L;
      for (const [cid, notes] of Object.entries(pat.notes)) {
        const c = chans.get(cid);
        if (!c) continue;
        for (const n of notes) {
          if (n.t >= L) continue;
          const tt = base + n.t;
          if (tt >= from && tt < to && tt >= s && tt < s + len) cb(c, n, tt, pat);
        }
      }
    }
  }
}

// Automation clips over [from, to): ramps the driven parameters. timeOf(tick) gives
// the audio time of a song tick. Song mode only.
export function scheduleAutomation(G, project, from, to, timeOf) {
  for (const clip of project.playlist.clips) {
    if (clip.type !== 'auto' || !clipValid(project, clip)) continue;
    const track = project.playlist.tracks[clip.track];
    if (track && track.mute) continue;
    const a = Math.max(from, clip.start);
    const b = Math.min(to, clip.start + clipLength(project, clip));
    if (a >= b || G.silent.has(clip.target)) continue;
    if (clip.target.startsWith('fx:')) {
      scheduleFxAutomation(G, project, clip, a, b, timeOf);
      continue;
    }
    const tp = targetParam(G, clip.target);
    if (!tp) continue;
    G.autoHold.add(clip.target);
    const step = STEP / 2;
    const ticks = [a];
    for (let x = Math.floor(a / step) * step + step; x < b; x += step) ticks.push(x);
    for (const x of ticks) {
      const v = tp.map(autoValue(clip.points, x - clip.start));
      const time = timeOf(x);
      if (!G.autoStarted.has(clip.target)) {
        tp.param.cancelScheduledValues(time);
        tp.param.setValueAtTime(v, time);
        G.autoStarted.add(clip.target);
      } else tp.param.linearRampToValueAtTime(v, time);
    }
  }
}

// Effect parameters change through messages, not AudioParams: values are applied
// at each step time (a timer while playing, suspend points in offline export).
function scheduleFxAutomation(G, project, clip, a, b, timeOf) {
  const fx = fxTarget(project, clip.target);
  if (!fx) return;
  for (let x = Math.ceil(a / STEP) * STEP; x < b; x += STEP) {
    const v = autoValue(clip.points, x - clip.start);
    const value = fx.def.min + v * (fx.def.max - fx.def.min);
    const apply = () => applyFx(G, project, fx, value);
    const time = timeOf(x);
    if (G.offline) {
      const q = Math.round((time * G.ctx.sampleRate) / 128) * 128 / G.ctx.sampleRate;
      if (!G.suspends) G.suspends = new Map();
      if (!G.suspends.has(q)) G.suspends.set(q, []);
      G.suspends.get(q).push(apply);
    } else {
      // Timers are cancelled on stop so no late value lands after the reset.
      const id = setTimeout(() => {
        G.fxTimers.delete(id);
        apply();
      }, Math.max(0, (time - G.ctx.currentTime) * 1000));
      G.fxTimers.add(id);
    }
  }
}

function applyFx(G, project, fx, value) {
  const hold = { ...(G.fxHold.get(fx.slot) || {}), [fx.def.id]: value };
  G.fxHold.set(fx.slot, hold);
  const ins = G.inserts[fx.index];
  const e = ins && ins.fxNodes.find((n) => n.slot === fx.slot);
  if (!e) return;
  const values = { ...paramValues(fx.plugin, fx.slot.params), ...hold };
  if (e.fx) e.fx.set(values, project.bpm);
  else e.node.port.postMessage({ type: 'params', values });
}

// Swing delays the notes that start on an odd 1/16 step, like FL Studio's
// channel rack swing. Returned in ticks; at 100% an odd step moves by half a step.
export function swingTicks(pat, t) {
  const sw = pat && pat.swing;
  if (!sw) return 0;
  return t % (2 * STEP) === STEP ? sw * STEP * 0.5 : 0;
}

// Delay compensation: processing delay (seconds) of the effects on the path of an
// insert, relative to the master. Notes and clips going through a delayed insert
// are started earlier by this time so everything stays in time.
function pathLatency(project, i, sr, depth = 0) {
  const m = project.mixer[i];
  if (!m || depth > 20) return 0;
  let lat = 0;
  for (const f of m.fx || []) {
    if (!f || f.on === false) continue;
    const p = getPlugin(f.plugin);
    if (p && p.latency) lat += p.latency(paramValues(p, f.params), sr);
  }
  if (i > 0) lat += pathLatency(project, m.route > i ? m.route : 0, sr, depth + 1);
  return lat;
}
export function insertLatency(project, i, sr) {
  if (!i) return 0;
  return Math.max(0, pathLatency(project, i, sr) - pathLatency(project, 0, sr));
}
function latencyCache(project, sr) {
  const cache = new Map();
  return (i) => {
    if (!cache.has(i)) cache.set(i, insertLatency(project, i, sr));
    return cache.get(i);
  };
}

// Mixer insert of the playlist track holding a clip (audio clips play through it).
export const trackInsert = (project, clip) => ((project.playlist.tracks[clip.track] || {}).insert || 0);

// Audio clips already sounding at a position (playback started inside them).
export function audioClipsAt(project, pos) {
  return project.playlist.clips.filter((c) => {
    if (c.type !== 'audio' || c.silent) return false;
    const track = project.playlist.tracks[c.track];
    if (track && track.mute) return false;
    return c.start < pos && pos < c.start + clipLength(project, c);
  });
}

export function loopLength(project, mode) {
  if (mode === 'live') return BAR * 4096;
  return mode === 'song' ? songLength(project) : patternLength(currentPattern(project));
}

export class Engine {
  constructor(store, getMode, getMetronome) {
    this.store = store;
    this.getMode = getMode;
    this.getMetronome = getMetronome;
    this.ctx = null;
    this.G = null;
    this.playing = false;
    this.pos = 0;
    this.voices = new Set();
    this.timer = null;
    this.load = 0; // share of the scheduler budget used, 0 to 1
    this.metroVol = 0.5;
    // Performance mode: pattern pads, each { from, until } in ticks, aligned on bars.
    this.live = new Map();
  }

  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.G = createGraph(this.ctx, this.ctx.destination);
      this.G.onPluginError = (p, msg) => this.onPluginError && this.onPluginError(p, msg);
      this.G.onModuleLoaded = () => this.sync();
      syncGraph(this.G, this.store.project, false);
      this.preloadPlugins();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  transportUpdate() {
    if (!this.G) return;
    const playing = this.playing;
    pushTransport(this.G, { bpm: playing ? this.bpm : this.store.project.bpm, playing, position: playing ? this.position() : this.pos, at: this.ctx.currentTime });
  }

  // Load every installed plugin into the audio thread so the first note plays.
  preloadPlugins() {
    if (!this.ctx) return;
    for (const p of allPlugins()) if (p.type !== 'extension') loadPluginModule(this.ctx, p);
  }

  // Channel outside the project used to preview an instrument, routed to the master.
  previewChannel(instrument) {
    this.init();
    const id = '__preview_' + instrument;
    if (!this.G.channels.has(id)) {
      const ctx = this.ctx;
      const ch = { in: ctx.createGain(), filt: ctx.createBiquadFilter(), pan: ctx.createStereoPanner(), insert: 0 };
      ch.in.gain.value = 0.78;
      ch.filt.frequency.value = 20000;
      ch.in.connect(ch.filt);
      ch.filt.connect(ch.pan);
      ch.pan.connect(this.G.inserts[0].in);
      this.G.channels.set(id, ch);
    }
    return { id, instrument, name: instrument, vol: 0.78, pan: 0, mute: false, insert: 0, params: { pitch: 0, attack: 0, release: 0, cutoff: 1, reso: 0 } };
  }

  // Play a few notes of an instrument (plugins are loaded first).
  async previewInstrument(instrument, keys = [60], dur = 0.7) {
    const c = this.previewChannel(instrument);
    if (instrument.startsWith('plugin:')) {
      const p = getPlugin(instrument.slice(7));
      if (!p || !(await loadPluginModule(this.ctx, p))) return;
    }
    for (const k of keys) playNote(this.G, c, this.ctx.currentTime + 0.02, k, 0.8, dur);
  }

  // Push button of a plugin on a channel.
  channelButton(channelId, id) {
    const e = this.G && this.G.pluginNodes.get(channelId);
    if (e) e.node.port.postMessage({ type: 'button', id });
  }

  // Push button of an effect in a mixer slot.
  effectButton(insert, slot, id) {
    const ins = this.G && this.G.inserts[insert];
    if (!ins) return;
    const e = ins.fxNodes.find((x) => x.slot === slot);
    if (e && e.node) e.node.port.postMessage({ type: 'button', id });
  }

  sync() {
    if (!this.G) return;
    syncGraph(this.G, this.store.project, true);
    if (!this.playing && this.G.transport.bpm !== this.store.project.bpm) this.transportUpdate();
  }

  spt() {
    return 60 / (this.bpm * PPQ);
  }

  tickToTime(abs) {
    return this.anchorTime + (abs - this.anchorTick) * this.spt();
  }

  timeToTick(time) {
    return this.anchorTick + (time - this.anchorTime) / this.spt();
  }

  // Playback range in loop ticks: the pattern, the song, or the loop region of the song.
  range() {
    const proj = this.store.project;
    const mode = this.getMode();
    const lp = proj.loop;
    if (mode === 'song' && lp && lp.on && lp.end > lp.start) return [lp.start, lp.end];
    return [0, loopLength(proj, mode)];
  }

  // countIn: bars of metronome before playback starts (used when recording).
  play({ countIn = 0 } = {}) {
    this.init();
    this.sync();
    const proj = this.store.project;
    const mode = this.getMode();
    const [A, B] = this.range();
    if (this.pos < A || this.pos >= B) this.pos = A;
    this.playing = true;
    this.bpm = bpmAt(proj, this.pos, mode);
    const t0 = this.ctx.currentTime + 0.05;
    const lead = countIn > 0 ? countIn * BAR * this.spt() : 0;
    for (let b = 0; lead && b < (countIn * BAR) / BEAT; b++) this.click(t0 + b * BEAT * this.spt(), (b * BEAT) % BAR === 0);
    this.anchorTime = t0 + lead;
    this.startAt = this.anchorTime;
    this.startPos = this.pos;
    this.anchorTick = 0;
    this.nextAbs = 0;
    this.nextPos = this.pos;
    this.fresh = true;
    this.G.autoStarted.clear();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
    this.G.transport = { bpm: this.bpm, playing: true, position: this.pos, at: this.anchorTime };
    pushTransport(this.G, this.G.transport);
  }

  // True while the count in clicks play.
  countingIn() {
    return this.playing && this.ctx && this.ctx.currentTime < this.startAt;
  }

  pause() {
    this.pos = this.position();
    this.halt();
  }

  stop() {
    this.halt();
    this.pos = 0;
  }

  togglePlay() {
    if (this.playing) this.pause();
    else this.play();
  }

  halt() {
    clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
    if (this.ctx) for (const v of this.voices) releaseVoice(this.ctx, v, true);
    this.voices.clear();
    if (this.G) {
      for (const e of this.G.pluginNodes.values()) e.node.port.postMessage({ type: 'stop' });
      // Give automated parameters back to the mixer and channel settings.
      for (const target of this.G.autoHold) {
        const tp = targetParam(this.G, target);
        if (tp) tp.param.cancelScheduledValues(0);
      }
      this.G.autoHold.clear();
      this.G.autoStarted.clear();
      for (const id of this.G.fxTimers) clearTimeout(id);
      this.G.fxTimers.clear();
      this.G.fxHold.clear();
      for (const ins of this.G.inserts) for (const e of ins.fxNodes || []) e.params = '';
      syncGraph(this.G, this.store.project, true);
    }
    this.transportUpdate();
  }

  setPosition(tick) {
    if (this.playing) {
      for (const v of this.voices) releaseVoice(this.ctx, v, true);
      this.voices.clear();
      this.anchorTime = this.ctx.currentTime + 0.03;
      this.startAt = this.anchorTime;
      this.anchorTick = 0;
      this.nextAbs = 0;
      this.nextPos = Math.max(0, tick);
      this.startPos = this.nextPos;
      this.bpm = bpmAt(this.store.project, this.nextPos, this.getMode());
      this.fresh = true;
      this.G.autoStarted.clear();
      for (const id of this.G.fxTimers) clearTimeout(id);
      this.G.fxTimers.clear();
      this.G.transport = { bpm: this.bpm, playing: true, position: this.nextPos, at: this.anchorTime };
      pushTransport(this.G, this.G.transport);
    } else this.pos = Math.max(0, tick);
  }

  // Current position in loop ticks.
  position() {
    if (!this.playing) return this.pos;
    if (this.ctx.currentTime < this.startAt) return this.startPos;
    const [A, B] = this.range();
    const span = Math.max(1, B - A);
    const now = this.timeToTick(this.ctx.currentTime);
    let p = this.nextPos - (this.nextAbs - now);
    while (p < A) p += span;
    if (p >= B) p = A + ((p - A) % span);
    return Math.min(p, B - 0.001);
  }

  schedule() {
    const t0 = performance.now();
    const ctx = this.ctx;
    const proj = this.store.project;
    const mode = this.getMode();
    // Tempo edited while playing: re-anchor now.
    const want = bpmAt(proj, this.nextPos, mode);
    if (want !== this.bpm) {
      const now = Math.max(ctx.currentTime, this.anchorTime);
      this.anchorTick = this.timeToTick(now);
      this.anchorTime = now;
      this.bpm = want;
      this.transportUpdate();
    }
    const horizon = this.timeToTick(ctx.currentTime + 0.12);
    const [A, L] = this.range();
    if (this.nextPos >= L || this.nextPos < A) this.nextPos = A;
    while (this.nextAbs < horizon) {
      const change = nextTempoChange(proj, this.nextPos, mode);
      const seg = Math.min(horizon - this.nextAbs, L - this.nextPos, change - this.nextPos);
      const spt = this.spt();
      const from = this.nextPos;
      const to = from + seg;
      const base = this.nextAbs - from;
      const lat = latencyCache(proj, ctx.sampleRate);
      // Start time and offset of an audio clip, moved earlier by the delay of its insert.
      const clipStart = (time, offset, ins) => {
        let t = time - lat(ins);
        if (t < ctx.currentTime) {
          offset += ctx.currentTime - t;
          t = ctx.currentTime;
        }
        return [t, offset];
      };
      if (mode === 'song' && this.fresh) {
        // Resume audio clips that started before this point.
        for (const clip of audioClipsAt(proj, from)) {
          const cl = clipLength(proj, clip) * spt;
          const ins = trackInsert(proj, clip);
          const [t, off] = clipStart(Math.max(this.tickToTime(this.nextAbs), ctx.currentTime), (from - clip.start) * spt, ins);
          const v = playAudioClip(this.G, clip, t, off, (clip.start + clipLength(proj, clip) - from) * spt - (off - (from - clip.start) * spt), spt, cl, ins);
          if (v) this.track(v);
        }
      }
      this.fresh = false;
      (mode === 'live' ? (a, b, cb) => this.liveEvents(proj, a, b, cb) : (a, b, cb, ca) => collectEvents(proj, mode, a, b, cb, ca))(from, to, (c, n, tt, pat) => {
        const time = Math.max(this.tickToTime(base + tt + swingTicks(pat, n.t)) - lat(c.insert), ctx.currentTime);
        const v = playNote(this.G, c, time, n.key, n.vel, n.len * spt, slideFrom(pat.notes[c.id], n));
        if (v) this.track(v);
      }, (clip, tt) => {
        const cl = clipLength(proj, clip) * spt;
        const ins = trackInsert(proj, clip);
        const [t, off] = clipStart(Math.max(this.tickToTime(base + tt), ctx.currentTime), 0, ins);
        const v = playAudioClip(this.G, clip, t, off, cl - off, spt, cl, ins);
        if (v) this.track(v);
      });
      if (mode === 'song') scheduleAutomation(this.G, proj, from, to, (x) => Math.max(this.tickToTime(base + x), ctx.currentTime));
      if (this.getMetronome()) {
        for (let b = Math.ceil(from / BEAT) * BEAT; b < to; b += BEAT) {
          this.click(this.tickToTime(base + b), b % BAR === 0);
        }
      }
      this.nextAbs += seg;
      this.nextPos = to;
      if (this.nextPos >= L - 1e-6) {
        this.nextPos = A;
        this.fresh = true;
        this.G.autoStarted.clear();
      }
      // Tempo change reached: continue with the new tempo from this exact tick.
      const nb = bpmAt(proj, this.nextPos, mode);
      if (nb !== this.bpm) {
        this.anchorTime = this.tickToTime(this.nextAbs);
        this.anchorTick = this.nextAbs;
        this.bpm = nb;
      }
      if (seg <= 0) break;
    }
    this.load = this.load * 0.9 + 0.1 * Math.min(1, (performance.now() - t0) / 25);
  }

  // Notes of the active pads in [from, to). Each pattern loops from bar 1.
  liveEvents(proj, from, to, cb) {
    const chans = new Map(proj.channels.map((c) => [c.id, c]));
    for (const [pid, pad] of this.live) {
      const pat = getPattern(proj, pid);
      if (!pat) continue;
      const L = patternLength(pat);
      const a = Math.max(from, pad.from);
      const b = Math.min(to, pad.until);
      if (a >= b) continue;
      for (let k = Math.floor(a / L); k * L < b; k++) {
        for (const [cid, notes] of Object.entries(pat.notes)) {
          const c = chans.get(cid);
          if (!c) continue;
          for (const n of notes) {
            const tt = k * L + n.t;
            if (n.t < L && tt >= a && tt < b) cb(c, n, tt, pat);
          }
        }
      }
    }
  }

  // Start or stop a pad on the next bar. Returns the tick where it changes.
  togglePad(pid) {
    const pos = this.playing ? this.position() : 0;
    const at = this.playing ? Math.ceil((pos + 1) / BAR) * BAR : 0;
    const pad = this.live.get(pid);
    if (pad && pad.until === Infinity) pad.until = Math.max(pad.from, at);
    else this.live.set(pid, { from: at, until: Infinity });
    return at;
  }

  track(v) {
    this.voices.add(v);
    if (this.voices.size > 256) {
      for (const x of this.voices) if (x.ended || x.end < this.ctx.currentTime - 1) this.voices.delete(x);
    }
  }

  // Number of voices sounding now.
  activeVoices() {
    if (!this.ctx) return 0;
    const now = this.ctx.currentTime;
    let n = 0;
    for (const v of this.voices) if (!v.ended && v.end > now) n += 1;
    return n;
  }

  click(time, accent) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = accent ? 1600 : 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0011, 0.36 * this.metroVol), time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    o.connect(g);
    g.connect(this.G.inserts[0].in);
    o.start(time);
    o.stop(time + 0.04);
  }

  preview(channel, key, vel = 0.78, dur = 0.35) {
    this.init();
    this.sync();
    playNote(this.G, channel, this.ctx.currentTime + 0.005, key, vel, dur);
  }

  // Play an imported sample from the browser, straight to the master.
  async previewSample(id) {
    this.init();
    const buf = getBuffer(id) || (await loadBuffer(id));
    if (!buf) return;
    if (this.previewVoice) releaseVoice(this.ctx, this.previewVoice, true);
    this.previewVoice = playAudioClip(this.G, { sampleId: id }, this.ctx.currentTime + 0.01, 0, Math.min(buf.duration, 30));
  }

  noteOn(channel, key, vel = 0.78) {
    this.init();
    this.sync();
    return playNote(this.G, channel, this.ctx.currentTime + 0.005, key, vel, Infinity);
  }

  noteOff(voice) {
    if (this.ctx && voice) releaseVoice(this.ctx, voice);
  }

  // Frequency data (dB per bin) of an insert, for the spectrum analyzer.
  spectrum(insert, out) {
    const ins = this.G && this.G.inserts[insert];
    if (!ins) return false;
    ins.an.getFloatFrequencyData(out);
    return true;
  }

  level(insert) {
    if (!this.G) return 0;
    const ins = this.G.inserts[insert];
    if (!ins) return 0;
    const buf = this._buf || (this._buf = new Float32Array(1024));
    ins.an.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
    return peak;
  }
}

// Copy of the project where only one channel sounds (only = channel id), or only
// the audio clips (only = 'audio'). Used for stem export.
export function soloProject(project, only) {
  const p = JSON.parse(JSON.stringify(project));
  for (const c of p.channels) if (c.id !== only) c.mute = true;
  if (only !== 'audio') for (const c of p.playlist.clips) if (c.type === 'audio') c.silent = true;
  return p;
}

// Peak normalization to -0.3 dBFS.
export function normalizeChannels(chs) {
  let peak = 0;
  for (const d of chs) for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak < 1e-6) return chs;
  const g = 0.966 / peak;
  for (const d of chs) for (let i = 0; i < d.length; i++) d[i] *= g;
  return chs;
}

// Render the song or the current pattern to a WAV ArrayBuffer.
// opts: { bits: 16 | 24, normalize }
export async function renderWav(project, mode, opts = {}) {
  const buf = await renderBuffer(project, mode);
  const chs = [buf.getChannelData(0), buf.getChannelData(1)];
  if (opts.normalize) normalizeChannels(chs);
  return encodeWav(chs, buf.sampleRate, opts.bits || 16);
}

// Float channel data, for encoders other than WAV (MP3).
export async function renderChannels(project, mode, opts = {}) {
  const buf = await renderBuffer(project, mode);
  const chs = [buf.getChannelData(0), buf.getChannelData(1)];
  if (opts.normalize) normalizeChannels(chs);
  return { channels: chs, sampleRate: buf.sampleRate };
}

// Render one stem per channel that has notes (and one for the audio clips in song mode).
// Returns [{ name, wav }]. The loop length of the full project is kept for every stem.
export async function renderStems(project, mode, onProgress, opts = {}) {
  const used = new Set();
  collectEvents(project, mode, 0, loopLength(project, mode), (c) => used.add(c.id));
  const jobs = project.channels.filter((c) => used.has(c.id) && !c.mute).map((c) => ({ id: c.id, name: c.name }));
  if (mode === 'song' && project.playlist.clips.some((c) => c.type === 'audio')) jobs.push({ id: 'audio', name: 'Audio clips' });
  const out = [];
  for (let i = 0; i < jobs.length; i++) {
    if (onProgress) onProgress(i, jobs.length, jobs[i].name);
    out.push({ name: jobs[i].name, wav: await renderWav(soloProject(project, jobs[i].id), mode, { bits: opts.bits }) });
  }
  return out;
}

function sampleIds(project, mode) {
  const ids = new Set();
  for (const c of project.channels) {
    if (c.instrument !== 'sampler') continue;
    if (c.sample) ids.add(c.sample);
    for (const z of c.zones || []) ids.add(z.sample);
  }
  if (mode === 'song') for (const c of project.playlist.clips) if (c.type === 'audio') ids.add(c.sampleId);
  return ids;
}

async function renderBuffer(project, mode) {
  await Promise.all([...sampleIds(project, mode)].map((id) => loadBuffer(id)));
  const plugins = new Map();
  for (const c of project.channels) {
    const p = c.instrument.startsWith('plugin:') ? getPlugin(c.instrument.slice(7)) : null;
    if (p) plugins.set(c.id, p);
  }
  const L = loopLength(project, mode);
  const timeOf = (tick) => tickToSec(project, tick, mode);
  const sr = 44100;
  const effects = new Set();
  for (const m of project.mixer) for (const f of m.fx || []) {
    const p = getPlugin(f && f.plugin);
    if (p && p.type === 'effect') effects.add(p);
  }
  const tail = 3;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(2, Math.ceil((timeOf(L) + tail) * sr), sr);
  const G = createGraph(ctx, ctx.destination);
  G.offline = true;
  G.transport = { bpm: project.bpm, playing: true, position: 0, at: 0 };
  // Effects must be loaded in this context before the graph is built.
  await Promise.all([...effects].map((p) => loadPluginModule(ctx, p)));
  syncGraph(G, project, false);
  const lat = latencyCache(project, sr);
  collectEvents(project, mode, 0, L, (c, n, tt, pat) => {
    const start = tt + swingTicks(pat, n.t);
    playNote(G, c, Math.max(0, timeOf(start) - lat(c.insert)), n.key, n.vel, timeOf(start + n.len) - timeOf(start), slideFrom(pat.notes[c.id], n));
  }, (clip, tt) => {
    const len = clipLength(project, clip);
    const dur = timeOf(tt + len) - timeOf(tt);
    const ins = trackInsert(project, clip);
    const t0 = timeOf(tt) - lat(ins);
    const off = Math.max(0, -t0);
    playAudioClip(G, clip, Math.max(0, t0), off, dur - off, dur / len, dur, ins);
  });
  if (mode === 'song') scheduleAutomation(G, project, 0, L, timeOf);
  if (G.suspends) {
    for (const [time, fns] of G.suspends) {
      if (time <= 0 || time >= ctx.length / sr) continue;
      ctx.suspend(time).then(() => {
        for (const fn of fns) fn();
        ctx.resume();
      });
    }
  }
  for (const [cid, p] of plugins) {
    const events = G.pluginEvents.get(cid);
    if (!events || !(await loadPluginModule(ctx, p))) continue;
    const c = project.channels.find((x) => x.id === cid);
    const node = new AudioWorkletNode(ctx, processorName(p), {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { params: paramValues(p, c.pluginParams), events, transport: G.transport },
    });
    node.connect(G.channels.get(cid).in);
  }
  return ctx.startRendering();
}
