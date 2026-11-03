// Rendering: every phrase of every track goes through its voice engine; results are
// cached by what they sound like, so only edited phrases render again.
import { makePhrases, pitchFn, curveFn, phraseKey } from './phrase.js';
import { renderBuiltin, BUILTIN_VOICES } from './voices/builtin.js';
import { renderUtau } from './voices/utau.js';
import { renderDiffSinger, getOrt } from './voices/diffsinger.js';
import { renderVoicevox } from './voices/voicevox.js';
import { builtinHumanizer, onnxHumanizer } from './voices/humanizer.js';
import { getVoice, loadBank, readFile } from './voices/library.js';
import { SR } from './dsp.js';
import { t, tErr } from './i18n.js';

const cache = new Map(); // key -> { data, missing, info, error }
export const settings = { humanizer: 'builtin', humanizeAmount: 1 };

export function clearCache() {
  cache.clear();
}

let humSession = null;
let humId = null;
async function humanizerFor(track, phrase, base) {
  if (!track.humanize) return null;
  if (settings.humanizer === 'builtin' || !settings.humanizer) {
    const seed = [...track.id].reduce((s, c) => s + c.charCodeAt(0), 0);
    return builtinHumanizer(seed, settings.humanizeAmount);
  }
  const v = await getVoice(settings.humanizer);
  if (!v || v.type !== 'humanizer') return builtinHumanizer(1, settings.humanizeAmount);
  const ort = await getOrt();
  if (humId !== v.id) {
    humSession = await ort.InferenceSession.create(await readFile(v.id, v.model));
    humId = v.id;
  }
  const fn = await onnxHumanizer(ort, humSession, phrase, base);
  return (x) => fn(x) * settings.humanizeAmount;
}

// Renders one phrase. Returns { data, missing, info, error }.
async function renderPhrase(ph, track, project) {
  const voiceId = track.voice || BUILTIN_VOICES[0].id;
  const v = voiceId.startsWith('builtin:') ? { id: voiceId, type: 'builtin' } : await getVoice(voiceId);
  if (!v) throw new Error('Voice not found: import it again or choose another voice for this track.');
  const base = pitchFn(ph.notes, track, project.bpm);
  const hum = v.type === 'utau' ? await humanizerFor(track, ph, base) : null;
  const pitch = hum ? pitchFn(ph.notes, track, project.bpm, hum) : base;
  const ctx = { pitch, dyn: curveFn(track, 'dyn', project.bpm), gen: curveFn(track, 'gen', project.bpm), bre: curveFn(track, 'bre', project.bpm), ten: curveFn(track, 'ten', project.bpm), sr: SR };
  if (v.type === 'builtin') return { data: renderBuiltin(ph, { ...ctx, voice: v.id }), missing: [] };
  if (v.type === 'utau') return renderUtau(ph, { ...ctx, bank: await loadBank(v) });
  if (v.type === 'diffsinger') return renderDiffSinger(ph, { ...ctx, bank: await loadBank(v), steps: track.steps, speaker: track.speaker });
  if (v.type === 'voicevox') return renderVoicevox(ph, { ...ctx, base: v.url, speaker: v.speaker, teacher: v.teacher });
  throw new Error('This item is not a singing voice: ' + v.name);
}

// Phrases of a track with their render state: [{ ph, key, done }].
export function trackPhrases(track, project) {
  return makePhrases(track, project).map((ph) => {
    const key = phraseKey(ph, track, project, settings.humanizer + settings.humanizeAmount);
    return { ph, key, done: cache.has(key), result: cache.get(key) || null };
  });
}

// Renders everything not cached yet. onProgress(done, total, label).
export async function renderProject(project, { onProgress = () => {}, signal = null, tracks = null } = {}) {
  const jobs = [];
  for (const tr of project.tracks) {
    if (tracks && !tracks.includes(tr.id)) continue;
    for (const p of trackPhrases(tr, project)) if (!p.done) jobs.push({ tr, ...p });
  }
  let done = 0;
  const problems = [];
  for (const j of jobs) {
    if (signal && signal.aborted) break;
    onProgress(done, jobs.length, j.tr.name);
    let res;
    try {
      res = await renderPhrase(j.ph, j.tr, project);
    } catch (e) {
      res = { data: new Float32Array(Math.ceil((j.ph.end - j.ph.start) * SR)), missing: [], error: String((e && e.message) || e) };
    }
    cache.set(j.key, res);
    if (cache.size > 600) cache.delete(cache.keys().next().value);
    if (res.error) problems.push(j.tr.name + ': ' + tErr(res.error));
    if (res.missing && res.missing.length) problems.push(j.tr.name + ': ' + [...new Set(res.missing)].join(' ') + t(' (no recording or phoneme)'));
    done++;
  }
  onProgress(done, jobs.length, '');
  return { rendered: done, problems: [...new Set(problems)] };
}

const audible = (project) => {
  const solo = project.tracks.some((x) => x.solo);
  return project.tracks.filter((x) => !x.mute && (!solo || x.solo));
};

// Mix of the rendered phrases (stereo), from `from` seconds, for export.
export function mixdown(project, { from = 0, to = null, only = null } = {}) {
  let end = 0;
  const parts = [];
  for (const tr of only ? project.tracks.filter((x) => x.id === only) : audible(project)) {
    for (const p of trackPhrases(tr, project)) {
      if (!p.result) continue;
      parts.push({ tr, ph: p.ph, data: p.result.data });
      end = Math.max(end, p.ph.end);
    }
  }
  const stop = to == null ? end : to;
  const n = Math.max(1, Math.ceil((stop - from) * SR));
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (const { tr, ph, data } of parts) {
    const gl = tr.vol * Math.min(1, 1 - tr.pan);
    const gr = tr.vol * Math.min(1, 1 + tr.pan);
    const base = Math.round((ph.start - from) * SR);
    for (let i = 0; i < data.length; i++) {
      const o = base + i;
      if (o < 0 || o >= n) continue;
      L[o] += data[i] * gl;
      R[o] += data[i] * gr;
    }
  }
  // Soft limit so loud mixes do not clip.
  for (const ch of [L, R]) for (let i = 0; i < n; i++) { const x = ch[i]; ch[i] = Math.abs(x) < 0.9 ? x : Math.sign(x) * (0.9 + 0.1 * Math.tanh((Math.abs(x) - 0.9) / 0.1)); }
  return { L, R, sr: SR };
}

// Player: plays the rendered phrases with the Web Audio API.
export class Player {
  constructor() {
    this.ctx = null;
    this.sources = [];
    this.playing = false;
    this.startAt = 0;
    this.from = 0;
  }
  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'playback', sampleRate: SR });
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  play(project, from = 0) {
    this.stop();
    const ctx = this.init();
    this.from = from;
    this.startAt = ctx.currentTime + 0.08;
    for (const tr of audible(project)) {
      const gain = ctx.createGain();
      gain.gain.value = tr.vol;
      const pan = ctx.createStereoPanner();
      pan.pan.value = tr.pan;
      gain.connect(pan).connect(ctx.destination);
      for (const p of trackPhrases(tr, project)) {
        if (!p.result || p.ph.end <= from) continue;
        const buf = ctx.createBuffer(1, p.result.data.length, SR);
        buf.copyToChannel(p.result.data, 0);
        const s = ctx.createBufferSource();
        s.buffer = buf;
        s.connect(gain);
        const off = Math.max(0, from - p.ph.start);
        s.start(this.startAt + Math.max(0, p.ph.start - from), off);
        this.sources.push(s, gain);
      }
    }
    this.playing = true;
  }
  stop() {
    for (const s of this.sources) {
      try {
        if (s.stop) s.stop();
        s.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    this.playing = false;
  }
  position() {
    if (!this.playing || !this.ctx) return this.from;
    return this.from + Math.max(0, this.ctx.currentTime - this.startAt);
  }
}
