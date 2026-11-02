import { BAR, STEP, MIXER_SIZE, TRACKS, PATTERN_COLORS, NKEYS, clamp } from './constants.js';
import { isInstrumentId } from './audio/catalog.js';
import { t } from './i18n.js';

let counter = 0;
export function newId(prefix) {
  counter += 1;
  return prefix + Date.now().toString(36) + counter.toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

export function defaultParams() {
  return { pitch: 0, attack: 0, release: 0, cutoff: 1, reso: 0 };
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
  if (c.type === 'audio') return BAR;
  return patternLength(getPattern(proj, c.patternId));
}

export function clipValid(proj, c) {
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
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.channels) || !Array.isArray(raw.patterns)) {
    throw new Error(t('Invalid project file'));
  }
  const p = newProject();
  p.name = str(raw.name, t('Untitled'));
  p.bpm = num(raw.bpm, 130, 10, 522);
  p.channels = raw.channels.slice(0, 64).map((c, i) => ({
    id: str(c.id, newId('c')),
    name: str(c.name, t('Channel ') + (i + 1)),
    instrument: isInstrumentId(c.instrument) ? c.instrument : 'piano',
    vol: num(c.vol, 0.78, 0, 1),
    pan: num(c.pan, 0, -1, 1),
    mute: !!c.mute,
    insert: Math.round(num(c.insert, 0, 0, MIXER_SIZE - 1)),
    sample: typeof c.sample === 'string' ? c.sample.slice(0, 80) : undefined,
    pluginParams: cleanParams(c.pluginParams),
    params: {
      pitch: Math.round(num(c.params?.pitch, 0, -24, 24)),
      attack: num(c.params?.attack, 0, 0, 2),
      release: num(c.params?.release, 0, 0, 3),
      cutoff: num(c.params?.cutoff, 1, 0, 1),
      reso: num(c.params?.reso, 0, 0, 1),
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
  if (raw.playlist && Array.isArray(raw.playlist.tracks)) {
    p.playlist.tracks.forEach((t, i) => {
      const rt = raw.playlist.tracks[i];
      if (rt) {
        t.name = str(rt.name, t.name);
        t.mute = !!rt.mute;
      }
    });
  }
  if (raw.playlist && Array.isArray(raw.playlist.clips)) {
    p.playlist.clips = raw.playlist.clips
      .filter((c) => c && (c.type === 'audio' ? typeof c.sampleId === 'string' : getPattern(p, c.patternId)))
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
        } else clip.patternId = c.patternId;
        const len = Math.round(num(c.len, 0, 0, BAR * 4096));
        if (len >= 1) clip.len = len;
        return clip;
      });
  }
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
      m.fx = Array.isArray(r.fx)
        ? r.fx
            .filter((f) => f && typeof f.plugin === 'string' && /^[a-z0-9-]{1,40}$/.test(f.plugin))
            .slice(0, FX_SLOTS)
            .map((f) => ({ plugin: f.plugin, on: f.on !== false, params: cleanParams(f.params) || {} }))
        : [];
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
