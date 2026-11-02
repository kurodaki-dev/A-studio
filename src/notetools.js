// Note transformations used by the piano roll tools and the channel rack.
// Every function works on plain note objects { t, len, key, vel } in ticks
// and changes them in place or returns a new array; none touches the store.
import { STEP, NKEYS, clamp } from './constants.js';

export const SCALES = [
  { id: 'major', name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harmonic', name: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'melodic', name: 'Melodic minor', steps: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'dorian', name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'phrygian', name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'lydian', name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'mixolydian', name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'pentaMajor', name: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  { id: 'pentaMinor', name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  { id: 'blues', name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
];

export const CHORDS = [
  { id: 'major', name: 'Major', iv: [0, 4, 7] },
  { id: 'minor', name: 'Minor', iv: [0, 3, 7] },
  { id: 'dim', name: 'Diminished', iv: [0, 3, 6] },
  { id: 'aug', name: 'Augmented', iv: [0, 4, 8] },
  { id: 'sus2', name: 'Sus2', iv: [0, 2, 7] },
  { id: 'sus4', name: 'Sus4', iv: [0, 5, 7] },
  { id: 'maj7', name: 'Major 7', iv: [0, 4, 7, 11] },
  { id: 'min7', name: 'Minor 7', iv: [0, 3, 7, 10] },
  { id: 'dom7', name: 'Dominant 7', iv: [0, 4, 7, 10] },
  { id: 'min9', name: 'Minor 9', iv: [0, 3, 7, 10, 14] },
  { id: 'power', name: 'Power', iv: [0, 7, 12] },
];

const getScale = (id) => SCALES.find((s) => s.id === id) || null;

// True when the key belongs to the scale (always true when no scale is set).
export function inScale(key, root, scaleId) {
  const s = getScale(scaleId);
  if (!s) return true;
  return s.steps.includes((((key - root) % 12) + 12) % 12);
}

// Nearest key of the scale, preferring the lower one on a tie.
export function nearestInScale(key, root, scaleId) {
  if (inScale(key, root, scaleId)) return key;
  for (let d = 1; d < 12; d++) {
    if (key - d >= 0 && inScale(key - d, root, scaleId)) return key - d;
    if (key + d < NKEYS && inScale(key + d, root, scaleId)) return key + d;
  }
  return key;
}

export function snapToScale(notes, root, scaleId) {
  for (const n of notes) n.key = nearestInScale(n.key, root, scaleId);
  return notes;
}

// Each note becomes the root of a chord. Returns the new notes to add.
export function chordify(notes, chordId) {
  const ch = CHORDS.find((c) => c.id === chordId) || CHORDS[0];
  const out = [];
  for (const n of notes) {
    for (const iv of ch.iv.slice(1)) {
      const key = n.key + iv;
      if (key < NKEYS) out.push({ t: n.t, len: n.len, key, vel: n.vel });
    }
  }
  return out;
}

// Group notes that start together (chords), sorted by time.
function groups(notes) {
  const map = new Map();
  for (const n of notes) {
    if (!map.has(n.t)) map.set(n.t, []);
    map.get(n.t).push(n);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g.sort((a, b) => a.key - b.key));
}

// Spread every chord over its length as a sequence of notes of `rate` ticks.
// pattern: 'up' | 'down' | 'updown'. Returns the replacement notes.
export function arpeggiate(notes, rate = STEP, pattern = 'up') {
  const out = [];
  for (const g of groups(notes)) {
    let order = g.slice();
    if (pattern === 'down') order.reverse();
    else if (pattern === 'updown' && g.length > 2) order = [...g, ...g.slice(1, -1).reverse()];
    const start = g[0].t;
    const end = Math.max(...g.map((n) => n.t + n.len));
    let i = 0;
    for (let tt = start; tt < end; tt += rate) {
      const src = order[i % order.length];
      out.push({ t: tt, len: Math.min(rate, end - tt), key: src.key, vel: src.vel });
      i += 1;
    }
  }
  return out;
}

// Delay each note of a chord a little more than the previous one, like a guitar strum.
export function strum(notes, ticks = 6, down = true) {
  for (const g of groups(notes)) {
    const order = down ? g : g.slice().reverse();
    order.forEach((n, i) => {
      const d = Math.min(i * ticks, Math.max(0, n.len - 1));
      n.t += d;
      n.len -= d;
    });
  }
  return notes;
}

// Small random changes of velocity and, optionally, timing. rnd is injectable for tests.
export function humanize(notes, { vel = 0.12, time = 0, rnd = Math.random } = {}) {
  for (const n of notes) {
    n.vel = clamp(n.vel + (rnd() * 2 - 1) * vel, 0.05, 1);
    if (time) n.t = Math.max(0, Math.round(n.t + (rnd() * 2 - 1) * time));
  }
  return notes;
}

// Extend every note to the start of the next one (chords keep their own end).
export function legato(notes) {
  const starts = [...new Set(notes.map((n) => n.t))].sort((a, b) => a - b);
  for (const n of notes) {
    const next = starts.find((s) => s > n.t);
    if (next !== undefined) n.len = next - n.t;
  }
  return notes;
}

// Play the notes backwards in time inside their own span.
export function reverseNotes(notes) {
  if (!notes.length) return notes;
  const a = Math.min(...notes.map((n) => n.t));
  const b = Math.max(...notes.map((n) => n.t + n.len));
  for (const n of notes) n.t = a + (b - (n.t + n.len));
  return notes;
}

// Mirror the keys around the middle of their range (the highest note becomes the lowest).
export function flipNotes(notes) {
  if (!notes.length) return notes;
  const lo = Math.min(...notes.map((n) => n.key));
  const hi = Math.max(...notes.map((n) => n.key));
  for (const n of notes) n.key = lo + hi - n.key;
  return notes;
}

// Scale lengths and positions around the first note (2 = twice as long).
export function stretchNotes(notes, factor) {
  if (!notes.length) return notes;
  const a = Math.min(...notes.map((n) => n.t));
  for (const n of notes) {
    n.t = Math.round(a + (n.t - a) * factor);
    n.len = Math.max(1, Math.round(n.len * factor));
  }
  return notes;
}

// Channel rack helpers on step notes (C5, one step long).
export function fillEach(every, length) {
  const out = [];
  for (let tt = 0; tt < length; tt += every * STEP) out.push({ t: tt, len: STEP, key: 60, vel: 0.78 });
  return out;
}

// Rotate notes by whole steps inside the pattern length.
export function shiftSteps(notes, steps, length) {
  const d = steps * STEP;
  for (const n of notes) n.t = (((n.t + d) % length) + length) % length;
  return notes;
}

export function randomSteps(length, density = 0.35, rnd = Math.random) {
  const out = [];
  for (let tt = 0; tt < length; tt += STEP) if (rnd() < density) out.push({ t: tt, len: STEP, key: 60, vel: 0.6 + rnd() * 0.4 });
  return out;
}
