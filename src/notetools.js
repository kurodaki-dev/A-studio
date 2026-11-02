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

// Key of a set of notes (Krumhansl profiles on the pitch classes weighted by length).
// Returns { root, type: 'major' | 'minor', score } or null when there are no notes.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function corr(a, b) {
  const ma = a.reduce((x, y) => x + y, 0) / 12;
  const mb = b.reduce((x, y) => x + y, 0) / 12;
  let n = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    n += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? n / Math.sqrt(da * db) : 0;
}
export function detectKey(notes) {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[((n.key % 12) + 12) % 12] += Math.max(1, n.len);
  if (!hist.some((x) => x > 0)) return null;
  let best = null;
  for (let r = 0; r < 12; r++) {
    for (const [type, prof] of [['major', MAJOR], ['minor', MINOR]]) {
      const rot = prof.map((_, i) => prof[(i - r + 12) % 12]);
      const score = corr(hist, rot);
      if (!best || score > best.score) best = { root: r, type, score };
    }
  }
  return best;
}

// Cut every note into pieces of `size` ticks (FL Studio "Chop").
export function chopNotes(notes, size) {
  const out = [];
  for (const n of notes) {
    if (n.len <= size) {
      out.push({ ...n });
      continue;
    }
    for (let t = 0; t < n.len; t += size) out.push({ ...n, t: n.t + t, len: Math.min(size, n.len - t) });
  }
  return out;
}

// Join notes of the same key that touch or overlap into one long note ("Glue").
export function glueNotes(notes) {
  const byKey = new Map();
  for (const n of notes) {
    if (!byKey.has(n.key)) byKey.set(n.key, []);
    byKey.get(n.key).push({ ...n });
  }
  const out = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.t - b.t);
    let cur = list[0];
    for (let i = 1; i < list.length; i++) {
      const n = list[i];
      if (n.t <= cur.t + cur.len) cur.len = Math.max(cur.len, n.t + n.len - cur.t);
      else {
        out.push(cur);
        cur = n;
      }
    }
    out.push(cur);
  }
  return out.sort((a, b) => a.t - b.t || a.key - b.key);
}

// A softer grace note just before each note ("Flam").
export function flamNotes(notes, gap) {
  return notes.filter((n) => n.t >= gap).map((n) => ({ ...n, t: n.t - gap, len: Math.max(1, Math.min(gap, n.len)), vel: Math.max(0.05, n.vel * 0.55) }));
}

// Velocity tools: 'up' (crescendo), 'down' (decrescendo), 'random', or a fixed value.
export function shapeVelocity(notes, mode, rnd = Math.random) {
  if (!notes.length) return notes;
  const a = Math.min(...notes.map((n) => n.t));
  const b = Math.max(...notes.map((n) => n.t));
  const span = Math.max(1, b - a);
  for (const n of notes) {
    const f = (n.t - a) / span;
    if (mode === 'up') n.vel = 0.25 + 0.75 * f;
    else if (mode === 'down') n.vel = 1 - 0.75 * f;
    else if (mode === 'random') n.vel = 0.45 + rnd() * 0.55;
    else n.vel = clamp(Number(mode) || 0.8, 0.05, 1);
    n.vel = Math.round(n.vel * 100) / 100;
  }
  return notes;
}

// Random melody in a scale (a small "riff machine"): steps of `step` ticks over `length`,
// moving mostly by small intervals around `center`, with rests and some longer notes.
export function makeRiff({ length, step, root = 0, scale = 'minor', center = 60, density = 0.7, rnd = Math.random }) {
  const keys = [];
  for (let k = center - 12; k <= center + 12; k++) if (scale === 'none' || inScale(k, root, scale)) keys.push(k);
  if (!keys.length) return [];
  let i = keys.findIndex((k) => k >= center);
  if (i < 0) i = Math.floor(keys.length / 2);
  const out = [];
  for (let t = 0; t < length; t += step) {
    if (t > 0 && rnd() > density) continue;
    const r = rnd();
    const move = r < 0.35 ? 0 : r < 0.6 ? 1 : r < 0.85 ? -1 : r < 0.93 ? 2 : -2;
    i = clamp(i + move, 0, keys.length - 1);
    const long = rnd() < 0.25 && t + step * 2 <= length;
    out.push({ t, key: keys[i], len: long ? step * 2 : step, vel: Math.round((0.65 + rnd() * 0.35) * 100) / 100 });
    if (long) t += step;
  }
  return out;
}

// MIDI sketch: a line drawn by hand ({ t, k } points, k as a fractional key) becomes
// notes. The line is read every `step` ticks (median pitch of the points in the step),
// equal neighbours are joined, and with glide a note that follows another without a
// gap slides from it. scale ({ root, type }) snaps the keys when given.
export function sketchToNotes(points, step, { glide = true, vel = 0.8, scale = null } = {}) {
  if (!points.length || step <= 0) return [];
  const pts = [...points].sort((a, b) => a.t - b.t);
  const buckets = new Map();
  for (const p of pts) {
    const b = Math.floor(p.t / step);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(p.k);
  }
  const notes = [];
  for (const b of [...buckets.keys()].sort((x, y) => x - y)) {
    const ks = buckets.get(b).sort((x, y) => x - y);
    let key = Math.round(ks[Math.floor(ks.length / 2)]);
    key = clamp(key, 0, NKEYS - 1);
    if (scale && scale.type && scale.type !== 'none') key = nearestInScale(key, scale.root, scale.type);
    const t = b * step;
    const prev = notes[notes.length - 1];
    if (prev && prev.t + prev.len === t && prev.key === key) {
      prev.len += step;
      continue;
    }
    const n = { t, key, len: step, vel };
    if (glide && prev && prev.t + prev.len === t) n.slide = true;
    notes.push(n);
  }
  return notes;
}
