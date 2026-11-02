import { INSTRUMENTS } from './instruments.js';
import { PPQ, BEAT, BAR, STEP, MIXER_SIZE } from '../constants.js';
import { patternLength, songLength, getPattern, currentPattern, clipLength } from '../store.js';
import { getBuffer, loadBuffer } from '../samples.js';
import { getPlugin, paramValues, loadPluginModule, pluginReady, processorName, allPlugins } from '../plugins.js';
import { encodeWav } from '../wav.js';

// Fader position to linear gain. 0.8 is 0 dB, like FL Studio's mixer.
export const faderGain = (v) => (v <= 0 ? 0 : Math.pow(v / 0.8, 2));
export const cutoffHz = (v) => 40 * Math.pow(20000 / 40, v);

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

export function createGraph(ctx, dest) {
  const G = { ctx, channels: new Map(), inserts: [], pluginNodes: new Map(), pluginEvents: new Map(), noteId: 0, transport: { bpm: 120, playing: false, position: 0, at: 0 } };
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
  masterIn.connect(masterPan);
  masterPan.connect(masterVol);
  masterVol.connect(limiter);
  limiter.connect(dest);
  limiter.connect(masterAn);
  G.inserts[0] = { in: masterIn, pan: masterPan, vol: masterVol, an: masterAn, fxSig: '', fxNodes: [] };

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
    inp.connect(pan);
    pan.connect(vol);
    vol.connect(masterIn);
    vol.connect(an);
    vol.connect(sr);
    sr.connect(rev);
    vol.connect(sd);
    sd.connect(del);
    G.inserts[i] = { in: inp, pan, vol, an, sr, sd, fxSig: '', fxNodes: [] };
  }
  return G;
}

function setParam(G, param, v, smooth) {
  if (smooth) param.setTargetAtTime(v, G.ctx.currentTime, 0.015);
  else param.value = v;
}

// Effect plugins of an insert: in -> fx 1 -> fx 2 ... -> pan. Rebuilt when the slots change.
function syncEffects(G, ins, m) {
  const slots = (m.fx || []).filter((f) => f && f.on !== false).map((f) => ({ f, p: getPlugin(f.plugin) })).filter((x) => x.p && x.p.type === 'effect');
  const ready = slots.filter((x) => {
    if (pluginReady(G.ctx, x.p)) return true;
    loadPluginModule(G.ctx, x.p).then((ok) => ok && G.onModuleLoaded && G.onModuleLoaded());
    return false;
  });
  const sig = ready.map((x) => processorName(x.p)).join('|');
  if (sig !== ins.fxSig) {
    ins.in.disconnect();
    for (const e of ins.fxNodes || []) e.node.disconnect();
    ins.fxNodes = ready.map((x) => {
      const params = paramValues(x.p, x.f.params);
      const node = new AudioWorkletNode(G.ctx, processorName(x.p), { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { params, transport: G.transport } });
      node.port.onmessage = (e) => {
        if (e.data && e.data.type === 'error' && G.onPluginError) G.onPluginError(x.p, e.data.message);
      };
      return { node, slot: x.f, params: JSON.stringify(params) };
    });
    let prev = ins.in;
    for (const e of ins.fxNodes) {
      prev.connect(e.node);
      prev = e.node;
    }
    prev.connect(ins.pan);
    ins.fxSig = sig;
  } else {
    // Same chain: only push parameter changes.
    ins.fxNodes.forEach((e, i) => {
      const x = ready[i];
      const values = paramValues(x.p, x.f.params);
      const json = JSON.stringify(values);
      if (json !== e.params) {
        e.params = json;
        e.node.port.postMessage({ type: 'params', values });
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
  for (const ins of G.inserts) for (const e of ins.fxNodes || []) e.node.port.postMessage(msg);
}

export function syncGraph(G, project, smooth) {
  const mx = project.mixer;
  const anySolo = mx.some((m, i) => i > 0 && m.solo);
  mx.forEach((m, i) => {
    const ins = G.inserts[i];
    if (!ins) return;
    syncEffects(G, ins, m);
    const muted = m.mute || (i > 0 && anySolo && !m.solo);
    setParam(G, ins.vol.gain, muted ? 0 : faderGain(m.vol), smooth);
    setParam(G, ins.pan.pan, m.pan, smooth);
    if (i > 0) {
      setParam(G, ins.sr.gain, m.reverb, smooth);
      setParam(G, ins.sd.gain, m.delay, smooth);
    }
  });
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
    setParam(G, ch.in.gain, c.mute ? 0 : c.vol, smooth);
    setParam(G, ch.pan.pan, c.pan, smooth);
    setParam(G, ch.filt.frequency, cutoffHz(c.params.cutoff), smooth);
    setParam(G, ch.filt.Q, 0.7 + c.params.reso * 14, smooth);
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

// Start one note. dur = Infinity holds it until releaseVoice().
// Imported sample played as a one shot, pitched from C5.
function playSampler(G, channel, ch, t, key, vel) {
  const buf = channel.sample ? getBuffer(channel.sample) : null;
  if (!buf) {
    if (channel.sample) loadBuffer(channel.sample);
    return null;
  }
  const ctx = G.ctx;
  const vg = ctx.createGain();
  vg.gain.value = vel;
  vg.connect(ch.in);
  const s = ctx.createBufferSource();
  s.buffer = buf;
  const rate = Math.pow(2, (key + (channel.params.pitch || 0) - 60) / 12);
  s.playbackRate.value = rate;
  s.connect(vg);
  s.start(t);
  const end = t + buf.duration / rate;
  s.stop(end);
  const voice = { vg, sources: [s], rel: 0.05, end, oneShot: true };
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

// Audio clip of the playlist, sent to the master. offset and dur in seconds.
export function playAudioClip(G, clip, t, offset, dur) {
  const buf = getBuffer(clip.sampleId);
  if (!buf) {
    loadBuffer(clip.sampleId);
    return null;
  }
  if (offset >= buf.duration) return null;
  const ctx = G.ctx;
  const vg = ctx.createGain();
  vg.gain.value = 0.8;
  vg.connect(G.inserts[0].in);
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.connect(vg);
  s.start(t, offset);
  const end = t + Math.min(dur, buf.duration - offset);
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

export function playNote(G, channel, t, key, vel, dur) {
  const ctx = G.ctx;
  const ch = G.channels.get(channel.id);
  if (!ch) return null;
  if (channel.instrument === 'sampler') return playSampler(G, channel, ch, t, key, vel);
  if (channel.instrument.startsWith('plugin:')) return playPlugin(G, channel, ch, t, key, vel, dur);
  const inst = INSTRUMENTS[channel.instrument] || INSTRUMENTS.piano;
  const p = channel.params;
  const f = 440 * Math.pow(2, (key + (p.pitch || 0) - 69) / 12);
  const vg = ctx.createGain();
  vg.connect(ch.in);
  const v = inst.play(ctx, vg, t, f, vel, dur);
  const rel = Math.max(inst.release || 0.05, p.release || 0);
  const off = Number.isFinite(dur) ? t + Math.max(dur, 0.005) : Infinity;
  const att = Math.max(0, p.attack || 0);
  if (att > 0 && !inst.oneShot) {
    const rampEnd = Math.min(t + att, off);
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(Math.min(1, (rampEnd - t) / att), rampEnd);
  }
  let end;
  if (inst.oneShot) end = t + v.length;
  else if (Number.isFinite(off)) {
    vg.gain.setTargetAtTime(0, off, rel / 4);
    end = off + rel * 1.6;
    if (v.length) end = Math.min(end, t + v.length);
  } else end = v.length ? t + v.length : Infinity;
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

// Calls cb(channel, note, tick) for every note starting in [from, to) of the loop,
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
    const track = project.playlist.tracks[clip.track];
    if (track && track.mute) continue;
    const s = clip.start;
    if (clip.type === 'audio') {
      if (s >= from && s < to && onAudio) onAudio(clip, s);
      continue;
    }
    const pat = getPattern(project, clip.patternId);
    if (!pat) continue;
    const L = patternLength(pat);
    const len = clipLength(project, clip);
    if (s >= to || s + len <= from) continue;
    // A stretched clip repeats its pattern.
    const k0 = Math.max(0, Math.floor((from - s) / L));
    const k1 = Math.floor((Math.min(to, s + len) - s) / L);
    for (let k = k0; k <= k1; k++) {
      const base = s + k * L;
      for (const [cid, notes] of Object.entries(pat.notes)) {
        const c = chans.get(cid);
        if (!c) continue;
        for (const n of notes) {
          if (n.t >= L) continue;
          const tt = base + n.t;
          if (tt >= from && tt < to && tt < s + len) cb(c, n, tt, pat);
        }
      }
    }
  }
}

// Swing delays the notes that start on an odd 1/16 step, like FL Studio's
// channel rack swing. Returned in ticks; at 100% an odd step moves by half a step.
export function swingTicks(pat, t) {
  const sw = pat && pat.swing;
  if (!sw) return 0;
  return t % (2 * STEP) === STEP ? sw * STEP * 0.5 : 0;
}

// Audio clips already sounding at a position (playback started inside them).
export function audioClipsAt(project, pos) {
  return project.playlist.clips.filter((c) => {
    if (c.type !== 'audio') return false;
    const track = project.playlist.tracks[c.track];
    if (track && track.mute) return false;
    return c.start < pos && pos < c.start + clipLength(project, c);
  });
}

export function loopLength(project, mode) {
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
    pushTransport(this.G, { bpm: this.store.project.bpm, playing, position: playing ? this.position() : this.pos, at: this.ctx.currentTime });
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
    if (e) e.node.port.postMessage({ type: 'button', id });
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

  play() {
    this.init();
    this.sync();
    this.playing = true;
    this.bpm = this.store.project.bpm;
    this.anchorTime = this.ctx.currentTime + 0.05;
    this.anchorTick = 0;
    this.nextAbs = 0;
    this.nextPos = this.pos;
    this.fresh = true;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
    this.G.transport = { bpm: this.bpm, playing: true, position: this.pos, at: this.anchorTime };
    pushTransport(this.G, this.G.transport);
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
    if (this.G) for (const e of this.G.pluginNodes.values()) e.node.port.postMessage({ type: 'stop' });
    this.transportUpdate();
  }

  setPosition(tick) {
    if (this.playing) {
      for (const v of this.voices) releaseVoice(this.ctx, v, true);
      this.voices.clear();
      this.anchorTime = this.ctx.currentTime + 0.03;
      this.anchorTick = 0;
      this.nextAbs = 0;
      this.nextPos = Math.max(0, tick);
      this.fresh = true;
      this.G.transport = { bpm: this.bpm, playing: true, position: this.nextPos, at: this.anchorTime };
      pushTransport(this.G, this.G.transport);
    } else this.pos = Math.max(0, tick);
  }

  // Current position in loop ticks.
  position() {
    if (!this.playing) return this.pos;
    const L = loopLength(this.store.project, this.getMode());
    const now = this.timeToTick(this.ctx.currentTime);
    let p = this.nextPos - (this.nextAbs - now);
    while (p < 0) p += L;
    return Math.min(p, L - 0.001) % L;
  }

  schedule() {
    const ctx = this.ctx;
    const proj = this.store.project;
    if (proj.bpm !== this.bpm) {
      const now = ctx.currentTime;
      this.anchorTick = this.timeToTick(now);
      this.anchorTime = now;
      this.bpm = proj.bpm;
      this.transportUpdate();
    }
    const mode = this.getMode();
    const horizon = this.timeToTick(ctx.currentTime + 0.12);
    const L = loopLength(proj, mode);
    const spt = this.spt();
    if (this.nextPos >= L) this.nextPos = 0;
    while (this.nextAbs < horizon) {
      const seg = Math.min(horizon - this.nextAbs, L - this.nextPos);
      const from = this.nextPos;
      const to = from + seg;
      const base = this.nextAbs - from;
      if (mode === 'song' && this.fresh) {
        // Resume audio clips that started before this point.
        for (const clip of audioClipsAt(proj, from)) {
          const v = playAudioClip(this.G, clip, Math.max(this.tickToTime(this.nextAbs), ctx.currentTime), (from - clip.start) * spt, (clip.start + clipLength(proj, clip) - from) * spt);
          if (v) this.track(v);
        }
      }
      this.fresh = false;
      collectEvents(proj, mode, from, to, (c, n, tt, pat) => {
        const time = Math.max(this.tickToTime(base + tt + swingTicks(pat, n.t)), ctx.currentTime);
        const v = playNote(this.G, c, time, n.key, n.vel, n.len * spt);
        if (v) this.track(v);
      }, (clip, tt) => {
        const time = Math.max(this.tickToTime(base + tt), ctx.currentTime);
        const v = playAudioClip(this.G, clip, time, 0, clipLength(proj, clip) * spt);
        if (v) this.track(v);
      });
      if (this.getMetronome()) {
        for (let b = Math.ceil(from / BEAT) * BEAT; b < to; b += BEAT) {
          this.click(this.tickToTime(base + b), b % BAR === 0);
        }
      }
      this.nextAbs += seg;
      this.nextPos = to;
      if (this.nextPos >= L - 1e-6) this.nextPos = 0;
    }
  }

  track(v) {
    this.voices.add(v);
    if (this.voices.size > 256) {
      for (const x of this.voices) if (x.ended || x.end < this.ctx.currentTime - 1) this.voices.delete(x);
    }
  }

  click(time, accent) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = accent ? 1600 : 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, time);
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

// Render the song or the current pattern to a WAV ArrayBuffer.
export async function renderWav(project, mode) {
  const ids = new Set();
  for (const c of project.channels) if (c.instrument === 'sampler' && c.sample) ids.add(c.sample);
  if (mode === 'song') for (const c of project.playlist.clips) if (c.type === 'audio') ids.add(c.sampleId);
  await Promise.all([...ids].map((id) => loadBuffer(id)));
  const plugins = new Map();
  for (const c of project.channels) {
    const p = c.instrument.startsWith('plugin:') ? getPlugin(c.instrument.slice(7)) : null;
    if (p) plugins.set(c.id, p);
  }
  const L = loopLength(project, mode);
  const spt = 60 / (project.bpm * PPQ);
  const sr = 44100;
  const effects = new Set();
  for (const m of project.mixer) for (const f of m.fx || []) {
    const p = getPlugin(f && f.plugin);
    if (p && p.type === 'effect') effects.add(p);
  }
  const tail = 3;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(2, Math.ceil((L * spt + tail) * sr), sr);
  const G = createGraph(ctx, ctx.destination);
  G.offline = true;
  G.transport = { bpm: project.bpm, playing: true, position: 0, at: 0 };
  // Effects must be loaded in this context before the graph is built.
  await Promise.all([...effects].map((p) => loadPluginModule(ctx, p)));
  syncGraph(G, project, false);
  collectEvents(project, mode, 0, L, (c, n, tt, pat) => {
    playNote(G, c, (tt + swingTicks(pat, n.t)) * spt, n.key, n.vel, n.len * spt);
  }, (clip, tt) => {
    playAudioClip(G, clip, tt * spt, 0, clipLength(project, clip) * spt);
  });
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
  const buf = await ctx.startRendering();
  return encodeWav([buf.getChannelData(0), buf.getChannelData(1)], sr);
}
