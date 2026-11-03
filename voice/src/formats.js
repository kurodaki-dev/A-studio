// Files: A Voice Studio projects (.avsp, JSON), UTAU sequences (.ust) and MIDI files
// with lyrics, imported as notes of a track.
import { decodeText } from './zip.js';
import { PPQ, makeNote } from './store.js';
import { normalizeLyric } from './lyrics.js';

// UST (UTAU): [#SETTING] Tempo=..., then [#0000] Length= Lyric= NoteNum= ... ("R" = rest).
export function parseUst(bytes) {
  const text = typeof bytes === 'string' ? bytes : decodeText(bytes);
  let tempo = 120;
  const notes = [];
  let cur = null;
  let t = 0;
  const flush = () => {
    if (!cur) return;
    const len = Math.max(1, Math.round(Number(cur.Length) || 0));
    const lyric = String(cur.Lyric ?? '').trim();
    if (cur.Tempo && Number(cur.Tempo) > 0 && !notes.length) tempo = Number(cur.Tempo);
    if (lyric && lyric !== 'R' && lyric !== 'r' && Number.isFinite(Number(cur.NoteNum))) {
      const n = makeNote(t, Math.max(0, Math.min(127, Math.round(Number(cur.NoteNum)))), len, normalizeLyric(lyric.replace(/^[a-z]+ /, '')));
      if (cur.Intensity) n.vel = Math.max(0.1, Math.min(1, Number(cur.Intensity) / 125));
      notes.push(n);
    }
    t += len;
    cur = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^\[#\d+\]$/.test(line)) {
      flush();
      cur = {};
    } else if (/^\[#/.test(line)) {
      flush();
      cur = null;
    } else if (line.includes('=')) {
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (cur) cur[k] = v;
      else if (k === 'Tempo' && Number(v) > 0) tempo = Number(v.replace(',', '.'));
    }
  }
  flush();
  return { tempo, notes };
}

// MIDI: notes of the first track that has notes, with lyric (or text) events as lyrics.
export function parseMidi(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const str = (o, n) => String.fromCharCode(...u8.subarray(o, o + n));
  if (str(0, 4) !== 'MThd') throw new Error('Not a MIDI file');
  const div = (u8[12] << 8) | u8[13];
  if (div & 0x8000) throw new Error('MIDI files with SMPTE time are not supported');
  const ntrk = (u8[10] << 8) | u8[11];
  let o = 14;
  let tempo = 120;
  const tracks = [];
  for (let k = 0; k < ntrk && o + 8 <= u8.length; k++) {
    if (str(o, 4) !== 'MTrk') break;
    const len = (u8[o + 4] << 24) | (u8[o + 5] << 16) | (u8[o + 6] << 8) | u8[o + 7];
    let p = o + 8;
    const end = Math.min(u8.length, p + len);
    let tick = 0;
    let status = 0;
    const on = new Map();
    const notes = [];
    const lyrics = [];
    const vlq = () => {
      let v = 0;
      let b;
      do {
        b = u8[p++];
        v = (v << 7) | (b & 0x7f);
      } while (b & 0x80 && p < end);
      return v;
    };
    while (p < end) {
      tick += vlq();
      let b = u8[p];
      if (b & 0x80) {
        status = b;
        p++;
      } else b = status;
      const type = status & 0xf0;
      if (status === 0xff) {
        const meta = u8[p++];
        const l = vlq();
        const data = u8.subarray(p, p + l);
        if (meta === 0x51 && l === 3 && tempo === 120 && tick === 0) tempo = 60000000 / ((data[0] << 16) | (data[1] << 8) | data[2]);
        if (meta === 0x05 || meta === 0x01) lyrics.push({ tick, text: decodeText(data).trim() });
        p += l;
      } else if (status === 0xf0 || status === 0xf7) {
        p += vlq();
      } else if (type === 0x90 || type === 0x80) {
        const key = u8[p++];
        const vel = u8[p++];
        if (type === 0x90 && vel > 0) on.set(key, { tick, vel });
        else if (on.has(key)) {
          const s = on.get(key);
          on.delete(key);
          notes.push({ t: s.tick, len: tick - s.tick, key, vel: s.vel / 127 });
        }
      } else if (type === 0xc0 || type === 0xd0) p += 1;
      else p += 2;
    }
    tracks.push({ notes, lyrics });
    o = end;
  }
  const tr = tracks.find((x) => x.notes.length);
  if (!tr) throw new Error('This MIDI file has no notes');
  const k = PPQ / div;
  const lyrics = [...tracks.flatMap((x) => x.lyrics)].filter((l) => l.text && !/^[#@]/.test(l.text));
  const notes = tr.notes.sort((a, b) => a.t - b.t).map((n) => {
    const l = lyrics.find((x) => Math.abs(x.tick - n.t) <= div / 16);
    const note = makeNote(Math.round(n.t * k), n.key, Math.max(15, Math.round(n.len * k)), l ? normalizeLyric(l.text) || 'ら' : 'ら');
    note.vel = Math.max(0.1, Math.min(1, n.vel));
    return note;
  });
  return { tempo: Math.round(tempo * 100) / 100, notes };
}
