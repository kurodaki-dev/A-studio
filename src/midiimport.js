// Standard MIDI File import (types 0 and 1). Notes go to a new pattern, one
// channel per MIDI track; the General MIDI drum channel (10) is split into the
// built in drum instruments.
import { PPQ, STEP, NKEYS, clamp } from './constants.js';
import { makePattern, nextPatternIndex, makeChannel } from './store.js';
import { instrumentName } from './audio/catalog.js';

function createChannel(p, inst) {
  if (p.channels.length >= 64) return null;
  const used = new Set(p.channels.map((c) => c.insert));
  let insert = 0;
  for (let i = 1; i < p.mixer.length; i++) if (!used.has(i)) { insert = i; break; }
  const c = makeChannel(inst, instrumentName(inst), insert);
  p.channels.push(c);
  return c;
}

const GM_TO_DRUM = { 35: 'kick', 36: 'kick', 37: 'rim', 38: 'snare', 40: 'snare', 39: 'clap', 42: 'hat', 44: 'hat', 46: 'ohat', 49: 'crash', 57: 'crash', 51: 'crash', 41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom', 50: 'tom', 56: 'cowbell' };
const PROGRAM_TO_INST = (prg) => {
  if (prg < 4) return 'piano';
  if (prg < 8) return 'epiano';
  if (prg < 16) return 'marimba';
  if (prg < 24) return 'organ';
  if (prg < 32) return 'guitar';
  if (prg < 40) return 'bass';
  if (prg < 56) return 'strings';
  if (prg < 64) return 'brass';
  if (prg < 72) return 'brass';
  if (prg < 80) return 'flute';
  if (prg < 88) return 'lead';
  if (prg < 96) return 'pad';
  if (prg < 104) return 'pad';
  if (prg < 112) return 'pluck';
  return 'bell';
};

// Parse the file. Returns { ppq, bpm, tracks: [{ name, notes: [{ t, len, key, vel, ch }], program }] }.
export function decodeMidi(bytes) {
  const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let pos = 0;
  const u32 = () => ((d[pos++] << 24) | (d[pos++] << 16) | (d[pos++] << 8) | d[pos++]) >>> 0;
  const u16 = () => (d[pos++] << 8) | d[pos++];
  const str4 = () => String.fromCharCode(d[pos++], d[pos++], d[pos++], d[pos++]);
  if (d.length < 14 || str4() !== 'MThd') throw new Error('Not a MIDI file');
  const hlen = u32();
  u16(); // format
  const ntracks = u16();
  const div = u16();
  if (div & 0x8000) throw new Error('SMPTE time is not supported');
  pos = 8 + hlen;
  let bpm = null;
  const tracks = [];
  for (let ti = 0; ti < ntracks && pos + 8 <= d.length; ti++) {
    const id = str4();
    const len = u32();
    const end = Math.min(d.length, pos + len);
    if (id !== 'MTrk') {
      pos = end;
      continue;
    }
    const vlq = () => {
      let v = 0;
      for (let i = 0; i < 4; i++) {
        const b = d[pos++];
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return v;
    };
    const tr = { name: '', notes: [], program: 0 };
    const open = new Map();
    let tick = 0;
    let status = 0;
    while (pos < end) {
      tick += vlq();
      let b = d[pos];
      if (b & 0x80) {
        status = b;
        pos++;
      }
      b = status;
      const type = b & 0xf0;
      const ch = b & 15;
      if (b === 0xff) {
        const mt = d[pos++];
        const ml = vlq();
        if (mt === 0x03 && !tr.name) tr.name = new TextDecoder().decode(d.subarray(pos, pos + ml)).slice(0, 60);
        if (mt === 0x51 && bpm == null && ml === 3) bpm = 60000000 / ((d[pos] << 16) | (d[pos + 1] << 8) | d[pos + 2]);
        pos += ml;
        if (mt === 0x2f) break;
      } else if (b === 0xf0 || b === 0xf7) {
        pos += vlq();
      } else if (type === 0x90 || type === 0x80) {
        const key = d[pos++];
        const vel = d[pos++];
        const k = ch * 128 + key;
        if (type === 0x90 && vel > 0) {
          if (!open.has(k)) open.set(k, []);
          open.get(k).push({ t: tick, vel });
        } else if (open.has(k) && open.get(k).length) {
          const on = open.get(k).shift();
          tr.notes.push({ t: on.t, len: Math.max(1, tick - on.t), key, vel: on.vel / 127, ch });
        }
      } else if (type === 0xc0) {
        tr.program = d[pos++];
      } else if (type === 0xd0) {
        pos += 1;
      } else {
        pos += 2; // a0, b0, e0
      }
    }
    for (const [k, list] of open) for (const on of list) tr.notes.push({ t: on.t, len: STEP, key: k % 128, vel: on.vel / 127, ch: Math.floor(k / 128) });
    pos = end;
    if (tr.notes.length) tracks.push(tr);
  }
  return { ppq: div, bpm, tracks };
}

// Add the parsed file to the project as a new pattern (caller commits).
// Returns { pattern, channels } counts.
export function importMidi(project, parsed, name) {
  const scale = PPQ / parsed.ppq;
  const pat = makePattern(nextPatternIndex(project));
  pat.name = (name || pat.name).slice(0, 40);
  let channels = 0;
  const toNote = (n, key) => ({ t: Math.round(n.t * scale), len: Math.max(1, Math.round(n.len * scale)), key: clamp(key, 0, NKEYS - 1), vel: clamp(n.vel, 0.05, 1) });
  for (const tr of parsed.tracks) {
    const drums = tr.notes.filter((n) => n.ch === 9);
    const melodic = tr.notes.filter((n) => n.ch !== 9);
    if (melodic.length) {
      const c = createChannel(project, PROGRAM_TO_INST(tr.program));
      if (!c) break;
      if (tr.name) c.name = tr.name;
      pat.notes[c.id] = melodic.map((n) => toNote(n, n.key));
      channels += 1;
    }
    const byInst = new Map();
    for (const n of drums) {
      const inst = GM_TO_DRUM[n.key] || 'tom';
      if (!byInst.has(inst)) byInst.set(inst, []);
      byInst.get(inst).push(n);
    }
    for (const [inst, list] of byInst) {
      let c = project.channels.find((x) => x.instrument === inst && pat.notes[x.id]);
      if (!c) {
        c = createChannel(project, inst);
        if (!c) break;
        channels += 1;
        pat.notes[c.id] = [];
      }
      for (const n of list) pat.notes[c.id].push({ ...toNote(n, 60), len: STEP });
    }
  }
  project.patterns.push(pat);
  project.currentPattern = pat.id;
  if (parsed.bpm) project.bpm = clamp(Math.round(parsed.bpm * 100) / 100, 10, 522);
  return { pattern: pat, channels };
}
