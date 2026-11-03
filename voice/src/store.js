// Project of A Voice Studio: vocal tracks with notes, lyrics and parameter curves.
// Times are in ticks (480 per beat), like OpenUtau and UTAU.

export const PPQ = 480;
export const NKEYS = 128;
export const CURVES = ['dyn', 'pit', 'bre', 'gen', 'ten'];
// Range and default of each curve: dynamics in %, pitch bend in cents, the others -100..100.
export const CURVE_INFO = {
  dyn: { min: 0, max: 200, def: 100 },
  pit: { min: -1200, max: 1200, def: 0 },
  bre: { min: -100, max: 100, def: 0 },
  gen: { min: -100, max: 100, def: 0 },
  ten: { min: -100, max: 100, def: 0 },
};
export const TRACK_COLORS = ['#7c9cff', '#ff7ca8', '#5ed6b4', '#ffb35c', '#b48cff', '#5cc8ff', '#e6d45c', '#ff8a6b'];

let idn = 0;
export function newId(p = 'x') {
  idn = (idn + 1) % 1e6;
  return p + Date.now().toString(36) + idn.toString(36) + Math.random().toString(36).slice(2, 6);
}

const num = (v, def, lo, hi) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
};
const str = (v, def, max = 80) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : def);

export function defaultVibrato() {
  return { depth: 0, rate: 5.5, delay: 0.35 };
}

export function makeNote(t, key, len = PPQ, lyric = 'ら') {
  return { id: newId('n'), t, len, key, lyric, vel: 0.8, porta: 80, vib: defaultVibrato() };
}

export function makeTrack(index, voice = 'builtin:aria') {
  return {
    id: newId('t'),
    name: 'Voice ' + (index + 1),
    voice,
    color: index % TRACK_COLORS.length,
    vol: 1,
    pan: 0,
    mute: false,
    solo: false,
    humanize: false,
    steps: 20,
    speaker: 0,
    notes: [],
    curves: {},
  };
}

export function newProject() {
  const tr = makeTrack(0);
  return { version: 1, app: 'a-voice-studio', name: 'Untitled', bpm: 120, beats: 4, tracks: [tr], current: tr.id };
}

function cleanCurve(arr, info) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .slice(0, 20000)
    .map((p) => [Math.max(0, Math.round(p[0])), num(p[1], info.def, info.min, info.max)])
    .sort((a, b) => a[0] - b[0]);
}

// Checks a project read from a file or storage. Unknown fields are dropped.
export function normalizeProject(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tracks)) throw new Error('Not an A Voice Studio project');
  const p = newProject();
  p.name = str(raw.name, 'Untitled');
  p.bpm = num(raw.bpm, 120, 20, 400);
  p.beats = Math.round(num(raw.beats, 4, 1, 12));
  p.tracks = raw.tracks.slice(0, 32).map((t, i) => {
    const tr = makeTrack(i);
    tr.id = str(t.id, tr.id, 40);
    tr.name = str(t.name, tr.name, 40);
    tr.voice = typeof t.voice === 'string' ? t.voice.slice(0, 200) : tr.voice;
    tr.color = Math.round(num(t.color, i, 0, TRACK_COLORS.length - 1));
    tr.vol = num(t.vol, 1, 0, 1.5);
    tr.pan = num(t.pan, 0, -1, 1);
    tr.mute = !!t.mute;
    tr.solo = !!t.solo;
    tr.humanize = !!t.humanize;
    tr.steps = Math.round(num(t.steps, 20, 1, 100));
    tr.speaker = Math.round(num(t.speaker, 0, 0, 255));
    tr.notes = (Array.isArray(t.notes) ? t.notes : [])
      .filter((n) => n && Number.isFinite(n.t) && Number.isFinite(n.key))
      .slice(0, 20000)
      .map((n) => ({
        id: str(n.id, newId('n'), 40),
        t: Math.max(0, Math.round(n.t)),
        len: Math.max(15, Math.round(num(n.len, PPQ, 15, PPQ * 256))),
        key: Math.round(num(n.key, 60, 0, NKEYS - 1)),
        lyric: typeof n.lyric === 'string' ? n.lyric.slice(0, 40) : 'ら',
        ...(typeof n.ph === 'string' && n.ph.trim() ? { ph: n.ph.slice(0, 80) } : {}),
        vel: num(n.vel, 0.8, 0, 1),
        porta: num(n.porta, 80, 0, 1000),
        vib: n.vib && typeof n.vib === 'object'
          ? { depth: num(n.vib.depth, 0, 0, 200), rate: num(n.vib.rate, 5.5, 0.5, 12), delay: num(n.vib.delay, 0.35, 0, 1) }
          : defaultVibrato(),
      }))
      .sort((a, b) => a.t - b.t);
    tr.curves = {};
    for (const k of CURVES) if (t.curves && t.curves[k]) tr.curves[k] = cleanCurve(t.curves[k], CURVE_INFO[k]);
    return tr;
  });
  if (!p.tracks.length) p.tracks = [makeTrack(0)];
  p.current = p.tracks.some((t) => t.id === raw.current) ? raw.current : p.tracks[0].id;
  return p;
}

export const serialize = (p) => JSON.stringify(p, (k, v) => (k === 's' ? undefined : v));

// Value of a curve at a tick (linear between points, the default outside).
export function curveAt(points, tick, def) {
  if (!points || !points.length) return def;
  if (tick <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (tick >= last[0]) return last[1];
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (points[m][0] <= tick) lo = m;
    else hi = m;
  }
  const [t0, v0] = points[lo];
  const [t1, v1] = points[hi];
  return t1 === t0 ? v1 : v0 + ((v1 - v0) * (tick - t0)) / (t1 - t0);
}

// Draws a line into a curve between two ticks (replacing the points there).
export function drawCurve(points, t0, v0, t1, v1, step = 10) {
  if (t1 < t0) [t0, v0, t1, v1] = [t1, v1, t0, v0];
  const kept = points.filter((p) => p[0] < t0 || p[0] > t1);
  const add = [];
  for (let t = t0; t <= t1; t += step) add.push([Math.round(t), t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0)]);
  if (!add.length || add[add.length - 1][0] !== Math.round(t1)) add.push([Math.round(t1), v1]);
  return kept.concat(add).sort((a, b) => a[0] - b[0]);
}

export const ticksToSec = (ticks, bpm) => (ticks / PPQ) * (60 / bpm);
export const secToTicks = (sec, bpm) => (sec * bpm * PPQ) / 60;

// Store with undo and redo: change() records the state before a change.
class Store {
  constructor() {
    this.project = newProject();
    this.undoStack = [];
    this.redoStack = [];
    this.subs = new Set();
  }
  subscribe(fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  emit() {
    for (const fn of this.subs) fn(this.project);
  }
  commit() {
    this.undoStack.push(serialize(this.project));
    if (this.undoStack.length > 120) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  change(fn) {
    this.commit();
    fn(this.project);
    this.emit();
  }
  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(serialize(this.project));
    this.project = normalizeProject(JSON.parse(this.undoStack.pop()));
    this.emit();
    return true;
  }
  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(serialize(this.project));
    this.project = normalizeProject(JSON.parse(this.redoStack.pop()));
    this.emit();
    return true;
  }
  load(p) {
    this.project = normalizeProject(p);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit();
  }
  track(id = this.project.current) {
    return this.project.tracks.find((t) => t.id === id) || this.project.tracks[0];
  }
}

export const store = new Store();
