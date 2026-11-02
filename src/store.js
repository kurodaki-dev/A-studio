import { BAR, STEP, MIXER_SIZE, TRACKS, PATTERN_COLORS, NKEYS, clamp, setBeatsPerBar, TIME_SIGS } from './constants.js';
import { isInstrumentId } from './audio/catalog.js';
import { cleanSynth } from './audio/osc3.js';
import { t } from './i18n.js';

let counter = 0;
export function newId(prefix) {
  counter += 1;
  return prefix + Date.now().toString(36) + counter.toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

export function defaultParams() {
  return { pitch: 0, fine: 0, attack: 0, decay: 0, sustain: 1, release: 0, cutoff: 1, reso: 0, glide: 0.1, start: 0, end: 1, loop: false, reverse: false };
}

export function makeChannel(instrument, name, insert = 0) {
  return { id: newId('c'), name, instrument, vol: 0.78, pan: 0, mute: false, insert, params: defaultParams() };
}

export function makePattern(index) {
  return { id: newId('p'), name: t('Pattern ') + index, color: (index - 1) % PATTERN_COLORS.length, minBars: 1, notes: {} };
}

export function makeMixer() {
  return Array.from({ length: MIXER_SIZE }, (_, i) => ({
    name: i === 0 ? 'Master' : t('Insert ') + i,
    vol: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    reverb: 0,
    delay: 0,
    route: 0,
    eq: [0, 0, 0],
    fx: [],
  }));
}

export const FX_SLOTS = 4;

export function newProject() {
  const defs = [
    ['kick', 'Kick'],
    ['clap', 'Clap'],
    ['hat', t('Hat')],
    ['snare', t('Snare')],
    ['piano', 'Piano'],
  ];
  const channels = defs.map(([inst, name], i) => makeChannel(inst, name, i + 1));
  const pat = makePattern(1);
  return {
    version: 1,
    name: t('Untitled'),
    bpm: 130,
    masterPitch: 0, // cents, whole project (like the FL Studio main pitch knob)
    author: '',
    notes: '',
    scale: { root: 0, type: 'none' },
    beats: 4,
    markers: [],
    loop: { on: false, start: 0, end: BAR * 4 },
    channels,
    patterns: [pat],
    currentPattern: pat.id,
    playlist: {
      tracks: Array.from({ length: TRACKS }, (_, i) => ({ name: t('Track ') + (i + 1), mute: false })),
      clips: [],
    },
    mixer: makeMixer(),
  };
}

export const getPattern = (proj, id) => proj.patterns.find((p) => p.id === id) || null;
export const currentPattern = (proj) => getPattern(proj, proj.currentPattern) || proj.patterns[0];
export const getChannel = (proj, id) => proj.channels.find((c) => c.id === id) || null;

export function notesOf(pat, channelId) {
  return (pat && pat.notes[channelId]) || [];
}

export function notesFor(pat, channelId) {
  if (!pat.notes[channelId]) pat.notes[channelId] = [];
  return pat.notes[channelId];
}

export function patternEnd(pat) {
  let end = 0;
  for (const arr of Object.values(pat.notes)) for (const n of arr) end = Math.max(end, n.t + n.len);
  return end;
}

export function patternLength(pat) {
  if (!pat) return BAR;
  return Math.max((pat.minBars || 1) * BAR, Math.ceil(patternEnd(pat) / BAR) * BAR);
}

// Length of a playlist clip in ticks. Pattern clips default to their pattern
// length and repeat it when stretched. Audio clips store their own length.
export function clipLength(proj, c) {
  if (c.len) return c.len;
  if (c.type === 'audio' || c.type === 'auto') return BAR;
  return patternLength(getPattern(proj, c.patternId));
}

// Automation target: 'mixer:<insert>:<param>' or 'channel:<id>:<param>'.
export const AUTO_TARGET = /^(mixer:(\d{1,2}):(vol|pan|reverb|delay|eq0|eq1|eq2)|channel:([\w-]{1,80}):(vol|pan|cutoff|reso)|fx:(\d{1,2}):(\d):([a-zA-Z][\w]{0,30}))$/;
export function autoTargetValid(proj, target) {
  const m = AUTO_TARGET.exec(target || '');
  if (!m) return false;
  if (m[2] != null) return Number(m[2]) < proj.mixer.length;
  if (m[6] != null) {
    const ins = proj.mixer[Number(m[6])];
    return !!(ins && ins.fx && ins.fx[Number(m[7])]);
  }
  return proj.channels.some((c) => c.id === m[4]);
}

export function clipValid(proj, c) {
  if (c.type === 'auto') return autoTargetValid(proj, c.target) && Array.isArray(c.points);
  return c.type === 'audio' ? typeof c.sampleId === 'string' : !!getPattern(proj, c.patternId);
}

export function songLength(proj) {
  let end = 0;
  for (const c of proj.playlist.clips) {
    if (clipValid(proj, c)) end = Math.max(end, c.start + clipLength(proj, c));
  }
  return Math.max(BAR, Math.ceil(end / BAR) * BAR);
}

// A channel shows step buttons when every note is a plain C5 step on the grid.
export function isStepChannel(notes) {
  return notes.every((n) => n.key === 60 && n.t % STEP === 0 && n.len === STEP);
}

export function nextPatternIndex(proj) {
  let max = 0;
  for (const p of proj.patterns) {
    const m = /^(?:Motif|Pattern) (\d+)$/.exec(p.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return Math.max(max, proj.patterns.length) + 1;
}

const num = (v, def, a, b) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, a, b) : def);
const str = (v, def) => (typeof v === 'string' && v.length ? v.slice(0, 80) : def);

function cleanParams(o) {
  if (!o || typeof o !== 'object') return undefined;
  return Object.fromEntries(Object.entries(o).filter(([k, v]) => /^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(k) && Number.isFinite(v)).slice(0, 16));
}

// Validate and complete a project loaded from storage or a file.
export function normalizeProject(raw) {
  // Parsing may change the bar length; give it back if parsing fails.
  const prevBar = BAR;
  try {
    return normalizeInner(raw);
  } catch (e) {
    setBeatsPerBar(prevBar / 96);
    throw e;
  }
}

function normalizeInner(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.channels) || !Array.isArray(raw.patterns)) {
    throw new Error(t('Invalid project file'));
  }
  const p = newProject();
  p.name = str(raw.name, t('Untitled'));
  p.bpm = num(raw.bpm, 130, 10, 522);
  p.masterPitch = Math.round(num(raw.masterPitch, 0, -1200, 1200));
  p.beats = TIME_SIGS.includes(raw.beats) ? raw.beats : 4;
  setBeatsPerBar(p.beats);
  p.markers = Array.isArray(raw.markers)
    ? raw.markers.filter((m) => m && Number.isFinite(m.t)).slice(0, 200).map((m) => {
        const o = { id: str(m.id, newId('m')), t: Math.max(0, Math.round(num(m.t, 0, 0, 1e9))), name: typeof m.name === 'string' ? m.name.slice(0, 40) : '' };
        if (Number.isFinite(m.bpm)) o.bpm = num(m.bpm, 130, 10, 522);
        return o;
      }).sort((a, b) => a.t - b.t)
    : [];
  if (raw.loop && typeof raw.loop === 'object') {
    const a = Math.max(0, Math.round(num(raw.loop.start, 0, 0, 1e9)));
    const b = Math.round(num(raw.loop.end, a + BAR, 0, 1e9));
    p.loop = { on: !!raw.loop.on, start: a, end: Math.max(a + STEP, b) };
  }
  p.author = typeof raw.author === 'string' ? raw.author.slice(0, 80) : '';
  p.notes = typeof raw.notes === 'string' ? raw.notes.slice(0, 2000) : '';
  if (raw.scale && typeof raw.scale === 'object') {
    p.scale = {
      root: Math.round(num(raw.scale.root, 0, 0, 11)),
      type: typeof raw.scale.type === 'string' && /^[a-zA-Z]{1,20}$/.test(raw.scale.type) ? raw.scale.type : 'none',
    };
  }
  p.channels = raw.channels.slice(0, 64).map((c, i) => ({
    id: str(c.id, newId('c')),
    name: str(c.name, t('Channel ') + (i + 1)),
    instrument: isInstrumentId(c.instrument) ? c.instrument : 'piano',
    vol: num(c.vol, 0.78, 0, 1),
    pan: num(c.pan, 0, -1, 1),
    mute: !!c.mute,
    insert: Math.round(num(c.insert, 0, 0, MIXER_SIZE - 1)),
    sample: typeof c.sample === 'string' ? c.sample.slice(0, 80) : undefined,
    color: Number.isInteger(c.color) ? clamp(c.color, 0, PATTERN_COLORS.length - 1) : undefined,
    group: typeof c.group === 'string' && c.group ? c.group.slice(0, 30) : undefined,
    slices: Array.isArray(c.slices) ? c.slices.filter((x) => Number.isFinite(x)).map((x) => clamp(x, 0, 1)).slice(0, 64) : undefined,
    zones: Array.isArray(c.zones) ? c.zones.filter((z) => z && typeof z.sample === 'string' && Number.isFinite(z.key)).slice(0, 128).map((z) => ({ key: Math.round(clamp(z.key, 0, NKEYS - 1)), sample: z.sample.slice(0, 80) })) : undefined,
    pluginParams: cleanParams(c.pluginParams),
    synth: c.instrument === 'osc3' ? cleanSynth(c.synth) : undefined,
    arp: c.arp && typeof c.arp === 'object' ? { on: !!c.arp.on, dir: Math.round(num(c.arp.dir, 0, 0, 3)), range: Math.round(num(c.arp.range, 1, 1, 4)), step: Math.round(num(c.arp.step, 1, 0, 3)), gate: num(c.arp.gate, 0.8, 0.05, 1) } : undefined,
    lfo: c.lfo && typeof c.lfo === 'object' ? { on: !!c.lfo.on, target: Math.round(num(c.lfo.target, 0, 0, 2)), shape: Math.round(num(c.lfo.shape, 0, 0, 3)), rate: num(c.lfo.rate, 5, 0.05, 30), sync: Math.round(num(c.lfo.sync, 0, 0, 6)), amount: num(c.lfo.amount, 0.5, 0, 1) } : undefined,
    params: {
      pitch: Math.round(num(c.params?.pitch, 0, -24, 24)),
      fine: Math.round(num(c.params?.fine, 0, -100, 100)),
      attack: num(c.params?.attack, 0, 0, 2),
      decay: num(c.params?.decay, 0, 0, 3),
      sustain: num(c.params?.sustain, 1, 0, 1),
      release: num(c.params?.release, 0, 0, 3),
      cutoff: num(c.params?.cutoff, 1, 0, 1),
      reso: num(c.params?.reso, 0, 0, 1),
      reverse: !!c.params?.reverse,
      glide: num(c.params?.glide, 0.1, 0, 1),
      start: num(c.params?.start, 0, 0, 1),
      end: num(c.params?.end, 1, 0, 1),
      loop: !!c.params?.loop,
      fadeIn: num(c.params?.fadeIn, 0, 0, 0.5),
      fadeOut: num(c.params?.fadeOut, 0, 0, 0.5),
      fenvAmt: num(c.params?.fenvAmt, 0, -1, 1),
      fenvA: num(c.params?.fenvA, 0.005, 0, 2),
      fenvD: num(c.params?.fenvD, 0.3, 0.01, 4),
      fenvS: num(c.params?.fenvS, 0, 0, 1),
      penvAmt: num(c.params?.penvAmt, 0, -24, 24),
      penvDecay: num(c.params?.penvDecay, 0.1, 0.005, 2),
      mono: !!c.params?.mono,
      maxPoly: Math.round(num(c.params?.maxPoly, 0, 0, 32)),
      porta: !!c.params?.porta,
    },
  }));
  const ids = new Set(p.channels.map((c) => c.id));
  p.patterns = raw.patterns.slice(0, 999).map((pt, i) => {
    const notes = {};
    for (const [cid, arr] of Object.entries(pt.notes || {})) {
      if (!ids.has(cid) || !Array.isArray(arr)) continue;
      notes[cid] = arr
        .filter((n) => n && typeof n.t === 'number' && typeof n.key === 'number')
        .map((n) => ({
          t: Math.max(0, Math.round(n.t)),
          len: Math.max(1, Math.round(num(n.len, STEP, 1, BAR * 1000))),
          key: Math.round(clamp(n.key, 0, NKEYS - 1)),
          vel: num(n.vel, 0.78, 0, 1),
          ...(n.slide ? { slide: true } : {}),
          ...(n.mute ? { mute: true } : {}),
        }));
    }
    return {
      id: str(pt.id, newId('p')),
      name: str(pt.name, t('Pattern ') + (i + 1)),
      color: Math.round(num(pt.color, i % PATTERN_COLORS.length, 0, PATTERN_COLORS.length - 1)),
      minBars: Math.round(num(pt.minBars, 1, 1, 64)),
      swing: num(pt.swing, 0, 0, 1),
      notes,
    };
  });
  if (!p.patterns.length) p.patterns = [makePattern(1)];
  p.currentPattern = getPattern(p, raw.currentPattern) ? raw.currentPattern : p.patterns[0].id;
  if (Array.isArray(raw.mixer)) {
    p.mixer.forEach((m, i) => {
      const r = raw.mixer[i];
      if (!r) return;
      m.name = str(r.name, m.name);
      m.vol = num(r.vol, 0.8, 0, 1);
      m.pan = num(r.pan, 0, -1, 1);
      m.mute = !!r.mute;
      m.solo = !!r.solo;
      m.reverb = num(r.reverb, 0, 0, 1);
      m.delay = num(r.delay, 0, 0, 1);
      m.route = Math.round(num(r.route, 0, 0, MIXER_SIZE - 1));
      if (m.route !== 0 && m.route <= i) m.route = 0;
      m.eq = [0, 1, 2].map((k) => num(Array.isArray(r.eq) ? r.eq[k] : 0, 0, -18, 18));
      m.fx = Array.isArray(r.fx)
        ? r.fx
            .filter((f) => f && typeof f.plugin === 'string' && /^[a-z0-9-]{1,40}$/.test(f.plugin))
            .slice(0, FX_SLOTS)
            .map((f) => ({ plugin: f.plugin, on: f.on !== false, params: cleanParams(f.params) || {}, ...(typeof f.source === 'string' ? { source: f.source.slice(0, 80) } : {}) }))
        : [];
    });
  }
  if (raw.playlist && Array.isArray(raw.playlist.tracks)) {
    p.playlist.tracks.forEach((t, i) => {
      const rt = raw.playlist.tracks[i];
      if (rt) {
        t.name = str(rt.name, t.name);
        t.mute = !!rt.mute;
        if (rt.solo) t.solo = true;
        // Track sound: volume, pan and transposition, kept only when changed.
        const vol = num(rt.vol, 1, 0, 1.5);
        const pan = num(rt.pan, 0, -1, 1);
        const pitch = Math.round(num(rt.pitch, 0, -24, 24));
        if (vol !== 1) t.vol = vol;
        if (pan) t.pan = pan;
        if (pitch) t.pitch = pitch;
        if (Number.isFinite(rt.color)) t.color = Math.round(clamp(rt.color, 0, PATTERN_COLORS.length - 1));
        const ins = Math.round(num(rt.insert, 0, 0, MIXER_SIZE - 1));
        if (ins) t.insert = ins;
      }
    });
  }
  if (raw.playlist && Array.isArray(raw.playlist.clips)) {
    p.playlist.clips = raw.playlist.clips
      .filter((c) => c && (c.type === 'audio' ? typeof c.sampleId === 'string' : c.type === 'auto' ? autoTargetValid(p, c.target) : getPattern(p, c.patternId)))
      .map((c) => {
        const clip = {
          id: str(c.id, newId('k')),
          track: Math.round(num(c.track, 0, 0, TRACKS - 1)),
          start: Math.max(0, Math.round(num(c.start, 0, 0, 1e9))),
        };
        if (c.type === 'audio') {
          clip.type = 'audio';
          clip.sampleId = c.sampleId.slice(0, 80);
          clip.name = str(c.name, 'Sample');
          // Optional properties are kept only when they differ from the default.
          const gain = num(c.gain, 1, 0, 2);
          const pitch = Math.round(num(c.pitch, 0, -24, 24));
          const fadeIn = Math.round(num(c.fadeIn, 0, 0, BAR * 64));
          const fadeOut = Math.round(num(c.fadeOut, 0, 0, BAR * 64));
          if (gain !== 1) clip.gain = gain;
          if (pitch) clip.pitch = pitch;
          if (fadeIn) clip.fadeIn = fadeIn;
          if (fadeOut) clip.fadeOut = fadeOut;
          if (c.reverse) clip.reverse = true;
        } else if (c.type === 'auto') {
          clip.type = 'auto';
          clip.target = c.target;
          clip.points = (Array.isArray(c.points) ? c.points : [])
            .filter((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]))
            .slice(0, 512)
            .map((q) => [Math.max(0, Math.round(q[0])), clamp(q[1], 0, 1)])
            .sort((a, b) => a[0] - b[0]);
          if (!clip.points.length) clip.points = [[0, 0.5]];
        } else clip.patternId = c.patternId;
        const off = Math.round(num(c.offset, 0, 0, BAR * 4096));
        if (off) clip.offset = off;
        if (c.mute) clip.mute = true;
        const len = Math.round(num(c.len, 0, 0, BAR * 4096));
        if (len >= 1) clip.len = len;
        return clip;
      });
  }
  return p;
}

// Selection flags ("s") live on note objects but never reach saved data.
export function serialize(proj) {
  return JSON.stringify(proj, (k, v) => (k === 's' ? undefined : v));
}

class Store {
  constructor() {
    this.project = newProject();
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    // Bumped whenever the project object is replaced, so views drop stale references.
    this.gen = 0;
  }
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    setBeatsPerBar(this.project.beats || 4);
    for (const fn of this.listeners) fn();
  }
  commit() {
    this.undoStack.push(serialize(this.project));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  // Drop the last snapshot and go back to it (used when a gesture cancels an edit).
  revert() {
    const s = this.undoStack.pop();
    if (s) {
      this.project = JSON.parse(s);
      this.gen += 1;
    }
    this.emit();
  }
  undo() {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.redoStack.push(serialize(this.project));
    this.project = JSON.parse(s);
    this.gen += 1;
    this.emit();
    return true;
  }
  redo() {
    const s = this.redoStack.pop();
    if (!s) return false;
    this.undoStack.push(serialize(this.project));
    this.project = JSON.parse(s);
    this.gen += 1;
    this.emit();
    return true;
  }
  load(raw) {
    this.project = normalizeProject(raw);
    this.gen += 1;
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }
  change(fn) {
    this.commit();
    fn(this.project);
    this.emit();
  }
}

export const store = new Store();
