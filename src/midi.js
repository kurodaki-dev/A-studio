// Standard MIDI File export (type 1, 96 ticks per quarter note like the app).
// Drums go to MIDI channel 10 with General MIDI drum notes, other channels get
// a General MIDI program close to their instrument.
import { PPQ } from './constants.js';
import { collectEvents, loopLength, swingTicks } from './audio/engine.js';
import { instrumentCat } from './audio/catalog.js';

const GM_PROGRAM = { piano: 0, epiano: 4, organ: 16, bass: 38, sub808: 38, lead: 80, pad: 88, pluck: 45, strings: 48, guitar: 24, flute: 73, brass: 61, marimba: 12, bell: 14 };
const GM_DRUM = { kick: 36, snare: 38, clap: 39, hat: 42, ohat: 46, crash: 49, tom: 45, rim: 37, cowbell: 56 };

function vlq(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

const text = (s) => [...new TextEncoder().encode(String(s).slice(0, 100))];

function chunk(type, data) {
  const len = data.length;
  return [...text(type), (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...data];
}

function trackData(events) {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const out = [];
  let last = 0;
  for (const e of events) {
    out.push(...vlq(Math.max(0, e.tick - last)), ...e.bytes);
    last = e.tick;
  }
  out.push(0, 0xff, 0x2f, 0); // end of track
  return out;
}

export function encodeMidi(project, mode) {
  const L = loopLength(project, mode);
  const perChannel = new Map();
  collectEvents(project, mode, 0, L, (c, n, tt, pat) => {
    if (!perChannel.has(c.id)) perChannel.set(c.id, []);
    perChannel.get(c.id).push({ t: Math.round(tt + swingTicks(pat, n.t)), len: Math.max(1, n.len), key: n.key, vel: n.vel });
  });

  const tempo = Math.round(60000000 / project.bpm);
  const tracks = [
    trackData([
      { tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(text(project.name).length), ...text(project.name)] },
      { tick: 0, order: 0, bytes: [0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255] },
      { tick: 0, order: 0, bytes: [0xff, 0x58, 4, 4, 2, 24, 8] },
    ]),
  ];
  let melodic = 0;
  for (const c of project.channels) {
    const notes = perChannel.get(c.id);
    if (!notes || !notes.length) continue;
    const drums = instrumentCat(c.instrument) === 'drums' && GM_DRUM[c.instrument] != null;
    let ch = 9;
    if (!drums) {
      ch = melodic % 15;
      if (ch >= 9) ch += 1; // skip the drum channel
      melodic += 1;
    }
    const events = [{ tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(text(c.name).length), ...text(c.name)] }];
    if (!drums) events.push({ tick: 0, order: 1, bytes: [0xc0 | ch, GM_PROGRAM[c.instrument] ?? 0] });
    for (const n of notes) {
      let key = n.key + (c.params.pitch || 0);
      if (drums) key = GM_DRUM[c.instrument] + (n.key - 60);
      key = Math.max(0, Math.min(127, key));
      const vel = Math.max(1, Math.min(127, Math.round(n.vel * 127)));
      events.push({ tick: n.t, order: 3, bytes: [0x90 | ch, key, vel] });
      events.push({ tick: n.t + n.len, order: 2, bytes: [0x80 | ch, key, 0] });
    }
    tracks.push(trackData(events));
  }
  const header = chunk('MThd', [0, 1, (tracks.length >> 8) & 255, tracks.length & 255, (PPQ >> 8) & 255, PPQ & 255]);
  return new Uint8Array([...header, ...tracks.flatMap((d) => chunk('MTrk', d))]);
}
