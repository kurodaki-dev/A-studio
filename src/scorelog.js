// Score log (like FL Studio): everything played live on a keyboard (piano roll keys,
// MIDI keyboard, channel settings test keys) is remembered for 5 minutes, so a good
// idea played without recording can still be turned into notes.
import { STEP, PPQ, BAR } from './constants.js';

const KEEP_MS = 5 * 60 * 1000;
const PHRASE_GAP_MS = 4000;
let log = [];

export function logNoteOn(channelId, key, vel, now = performance.now()) {
  const e = { channelId, key, vel, on: now, off: null };
  log.push(e);
  const limit = now - KEEP_MS;
  if (log.length > 4000 || (log[0] && log[0].on < limit)) log = log.filter((x) => x.on >= limit).slice(-4000);
  return e;
}

export function logNoteOff(e, now = performance.now()) {
  if (e && e.off == null) e.off = now;
}

export function scoreLogSize() {
  return log.length;
}

export function clearScoreLog() {
  log = [];
}

// The last phrase (notes after the last pause of 4 s or more) as pattern notes per
// channel, starting at tick 0, quantized to a 1/32 note. bpm gives the tick length.
export function lastPhrase(bpm, entries = log) {
  if (!entries.length) return null;
  const list = [...entries].sort((a, b) => a.on - b.on);
  let start = list.length - 1;
  let end = list[start].off ?? list[start].on;
  for (let i = list.length - 2; i >= 0; i--) {
    const stop = list[i].off ?? list[i].on;
    if (list[i + 1].on - Math.max(stop, list[i].on) >= PHRASE_GAP_MS && list[i + 1].on - list[i].on >= PHRASE_GAP_MS) break;
    start = i;
  }
  const phrase = list.slice(start);
  for (const e of phrase) end = Math.max(end, e.off ?? e.on + 250);
  const t0 = phrase[0].on;
  const msPerTick = 60000 / (bpm * PPQ);
  const q = STEP / 2;
  const byChannel = {};
  let last = 0;
  for (const e of phrase) {
    const t = Math.round((e.on - t0) / msPerTick / q) * q;
    const len = Math.max(q, Math.round(((e.off ?? e.on + 250) - e.on) / msPerTick / q) * q);
    (byChannel[e.channelId] || (byChannel[e.channelId] = [])).push({ t, key: e.key, len, vel: e.vel });
    last = Math.max(last, t + len);
  }
  return { byChannel, bars: Math.max(1, Math.ceil(last / BAR)), count: phrase.length };
}
