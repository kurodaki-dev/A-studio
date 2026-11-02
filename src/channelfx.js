// Channel note processing done before playback (like FL Studio's channel settings):
// arpeggiator, mono (each note stops the previous one) and portamento (every note
// glides from the previous one). Works on copies; the pattern is not changed.
import { STEP, BEAT, BAR } from './constants.js';

export const ARP_STEPS = [
  { id: '1/32', ticks: STEP / 2 },
  { id: '1/16', ticks: STEP },
  { id: '1/8', ticks: STEP * 2 },
  { id: '1/4', ticks: BEAT },
];
export const LFO_SYNC = [
  { id: 'free', beats: 0 },
  { id: '1/16', beats: 0.25 },
  { id: '1/8', beats: 0.5 },
  { id: '1/4', beats: 1 },
  { id: '1/2', beats: 2 },
  { id: '1 bar', beats: 4 },
  { id: '2 bars', beats: 8 },
];

// Pseudo random but repeatable order for the random arpeggio.
const hashRand = (i) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// arp: { on, dir: 0 up, 1 down, 2 up and down, 3 random, range: octaves 1..4, step: index of ARP_STEPS, gate: 0.1..1 }
export function arpExpand(notes, arp) {
  const step = (ARP_STEPS[arp.step] || ARP_STEPS[1]).ticks;
  const gate = Math.max(0.05, Math.min(1, arp.gate == null ? 0.8 : arp.gate));
  const range = Math.max(1, Math.min(4, Math.round(arp.range || 1)));
  const groups = new Map();
  for (const n of notes) {
    if (!groups.has(n.t)) groups.set(n.t, []);
    groups.get(n.t).push(n);
  }
  const out = [];
  for (const [t0, g] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    g.sort((a, b) => a.key - b.key);
    let seq = [];
    for (let o = 0; o < range; o++) for (const n of g) seq.push({ key: n.key + 12 * o, vel: n.vel });
    if (arp.dir === 1) seq.reverse();
    else if (arp.dir === 2 && seq.length > 2) seq = [...seq, ...seq.slice(1, -1).reverse()];
    const end = Math.max(...g.map((n) => n.t + n.len));
    let i = 0;
    for (let t = t0; t < end; t += step, i++) {
      const src = arp.dir === 3 ? seq[Math.floor(hashRand(t0 * 31 + i) * seq.length)] : seq[i % seq.length];
      out.push({ t, len: Math.max(1, Math.round(Math.min(step * gate, end - t))), key: src.key, vel: src.vel });
    }
  }
  return out;
}

// Mono: a note ends where the next one starts. Porta: each note glides from the previous one.
export function monoPorta(notes, mono, porta) {
  const s = notes.map((n) => ({ ...n })).sort((a, b) => a.t - b.t || b.key - a.key);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const n = s[i];
    // Mono keeps only the highest note of a chord.
    if (mono && i > 0 && s[i - 1].t === n.t) continue;
    out.push(n);
  }
  for (let i = 0; i < out.length; i++) {
    const n = out[i];
    const next = out[i + 1];
    if (mono && next && n.t + n.len > next.t) n.len = Math.max(1, next.t - n.t);
    const prev = out[i - 1];
    if (porta && prev && n.t - (prev.t + prev.len) < BAR / 2) n.slideFromKey = prev.key;
  }
  return out;
}

// Max polyphony (like FL Studio): at most `max` notes sound together. A new note cuts
// the oldest one still sounding; in a chord beyond the limit the highest notes stay.
export function polyLimit(notes, max) {
  if (!max || max < 1) return notes;
  const s = notes.map((n) => ({ ...n })).sort((a, b) => a.t - b.t || b.key - a.key);
  const out = [];
  const sounding = [];
  for (let i = 0; i < s.length; i++) {
    const n = s[i];
    for (let j = sounding.length - 1; j >= 0; j--) if (sounding[j].t + sounding[j].len <= n.t) sounding.splice(j, 1);
    // Same start as max notes already kept: the chord is full.
    if (sounding.filter((x) => x.t === n.t).length >= max) continue;
    while (sounding.length >= max) {
      const old = sounding.shift();
      old.len = Math.max(1, n.t - old.t);
    }
    sounding.push(n);
    out.push(n);
  }
  return out;
}

const active = (c) => (c.arp && c.arp.on) || (c.params && (c.params.mono || c.params.porta || c.params.maxPoly));

// Notes of a channel as they will play. Cached until the notes or the settings change.
const cache = new WeakMap();
// Notes without the muted ones (muted notes stay in the piano roll but do not play).
const unmutedCache = new WeakMap();
function unmuted(notes) {
  let muted = 0;
  for (const n of notes) if (n.mute) muted++;
  if (!muted) return notes;
  const hit = unmutedCache.get(notes);
  let h = notes.length;
  for (const n of notes) h = (h * 31 + n.t * 7 + n.len * 13 + n.key + (n.mute ? 5 : 0) + n.vel * 100) % 1e9;
  if (hit && hit.h === h) return hit.out;
  const out = notes.filter((n) => !n.mute);
  unmutedCache.set(notes, { h, out });
  return out;
}

export function channelNotes(c, notes) {
  notes = unmuted(notes);
  if (!active(c) || !notes.length) return notes;
  let sig = JSON.stringify([c.arp, c.params.mono, c.params.porta, c.params.maxPoly]) + notes.length;
  let h = 0;
  for (const n of notes) h = (h * 31 + n.t * 7 + n.len * 13 + n.key + n.vel * 100) % 1e9;
  sig += ':' + h;
  const hit = cache.get(notes);
  if (hit && hit.sig === sig) return hit.out;
  let out = notes;
  if (c.arp && c.arp.on) out = arpExpand(out, c.arp);
  if (c.params.maxPoly && !c.params.mono) out = polyLimit(out, c.params.maxPoly);
  if (c.params.mono || c.params.porta) out = monoPorta(out, !!c.params.mono, !!c.params.porta);
  cache.set(notes, { sig, out });
  return out;
}
