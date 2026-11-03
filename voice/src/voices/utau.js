// UTAU / OpenUTAU voicebanks: WAV recordings described by oto.ini (alias, offset,
// consonant, cutoff, preutterance, overlap). Each note picks a recording (CV or VCV),
// keeps its consonant as recorded and stretches its vowel, at the wanted pitch (PSOLA).
import { decodeText } from '../zip.js';
import { decodeWav, resample, pitchTrack, pitchMarks, psola } from '../dsp.js';
import { toKatakana, kanaToRomaji, moraVowel } from '../lyrics.js';
import { midiToHz } from '../phrase.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

// oto.ini text -> entries. `dir` is the folder of the oto.ini inside the bank.
export function parseOto(text, dir = '') {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const eq = line.indexOf('=');
    if (!line || eq < 1) continue;
    const file = line.slice(0, eq).trim();
    const f = line.slice(eq + 1).split(',');
    const n = (i) => {
      const v = parseFloat(f[i]);
      return Number.isFinite(v) ? v : 0;
    };
    const alias = (f[0] || '').trim() || file.replace(/\.wav$/i, '');
    out.push({ file: (dir ? dir + '/' : '') + file, alias, offset: n(1), consonant: n(2), cutoff: n(3), preutter: n(4), overlap: n(5) });
  }
  return out;
}

// prefix.map text -> { "C4": { prefix, suffix } }.
export function parsePrefixMap(text) {
  const map = {};
  for (const line of text.split(/\r?\n/)) {
    const p = line.split('\t');
    if (p.length >= 2 && p[0].trim()) map[p[0].trim()] = { prefix: p[1] || '', suffix: p[2] || '' };
  }
  return map;
}

// character.txt -> { name, image }.
export function parseCharacter(text) {
  const info = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(name|image|author|web)\s*=\s*(.*)$/i.exec(line);
    if (m) info[m[1].toLowerCase()] = m[2].trim();
  }
  return info;
}

const lower = (s) => s.toLowerCase();

// Loads a bank from a source ({ names, read(path) }) under the folder `root`.
export async function loadUtau(src, root = '') {
  const pre = root ? root.replace(/\/?$/, '/') : '';
  const inRoot = src.names.filter((n) => n.startsWith(pre));
  const otoFiles = inRoot.filter((n) => /(^|\/)oto\.ini$/i.test(n));
  if (!otoFiles.length) throw new Error('No oto.ini in this voicebank');
  const entries = new Map();
  for (const f of otoFiles.sort((a, b) => a.length - b.length)) {
    const dir = f.slice(0, f.lastIndexOf('/') < 0 ? 0 : f.lastIndexOf('/'));
    for (const e of parseOto(decodeText(await src.read(f)), dir)) if (!entries.has(e.alias)) entries.set(e.alias, e);
  }
  const findFile = (name) => inRoot.find((n) => lower(n) === lower(pre + name)) || null;
  const pm = findFile('prefix.map');
  const prefixMap = pm ? parsePrefixMap(decodeText(await src.read(pm))) : {};
  const ch = findFile('character.txt');
  const character = ch ? parseCharacter(decodeText(await src.read(ch))) : {};
  const fileSet = new Map(src.names.map((n) => [lower(n), n]));
  const samples = new Map();
  return {
    type: 'utau',
    name: character.name || root.split('/').filter(Boolean).pop() || 'UTAU',
    image: character.image ? findFile(character.image) : null,
    entries,
    prefixMap,
    // The recording for a lyric: VCV after a vowel, else CV (kana, katakana or romaji),
    // with the prefix.map affixes of the note first.
    lookup(lyric, prevVowel, key, raw = '') {
      const kana = lyric;
      const forms = lyric === 'br' ? ['息', 'br', 'breath', '吸'] : [kana, toKatakana(kana), kanaToRomaji(kana)];
      if (raw && !forms.includes(raw)) forms.push(raw);
      const bases = [];
      if (prevVowel) for (const f of forms) bases.push(prevVowel + ' ' + f);
      else for (const f of forms) bases.push('- ' + f);
      bases.push(...forms);
      if (prevVowel) for (const f of forms) bases.push('- ' + f);
      const aff = prefixMap[noteName(key)];
      for (const b of bases) {
        if (aff && (aff.prefix || aff.suffix)) {
          const e = entries.get(aff.prefix + b + aff.suffix);
          if (e) return e;
        }
        const e = entries.get(b);
        if (e) return e;
      }
      return null;
    },
    // Decoded recording at 44.1 kHz with its pitch analysis (cached).
    async sample(file, sr = 44100) {
      let s = samples.get(file);
      if (s) return s;
      const real = fileSet.get(lower(file));
      if (!real) throw new Error('Missing recording: ' + file);
      const w = decodeWav(await src.read(real));
      const data = resample(w.data, w.sr, sr);
      const track = pitchTrack(data, sr);
      s = { data, sr, track, marks: pitchMarks(data, sr, track) };
      if (samples.size > 400) samples.clear();
      samples.set(file, s);
      return s;
    },
  };
}

// Renders a phrase with a loaded bank. ctx: { bank, pitch(t) MIDI, dyn(t) %, sr }.
// Returns { data, missing } (lyrics without a recording).
export async function renderUtau(phrase, { bank, pitch, dyn, sr = 44100 }) {
  const notes = phrase.notes;
  const len = Math.ceil((phrase.end - phrase.start) * sr);
  const out = new Float32Array(len);
  const missing = [];
  // Pass 1: recordings and timing (preutterance and overlap fit the note before).
  const plan = notes.map((n, i) => {
    const prev = notes[i - 1];
    const joined = prev && n.start - prev.end < 0.08;
    const prevVowel = joined ? prev.vowel : null;
    const e = bank.lookup(n.lyric, prevVowel, n.key, n.raw);
    if (!e) {
      missing.push(n.lyric);
      return null;
    }
    let pre = e.preutter / 1000;
    let ovl = e.overlap / 1000;
    const room = joined ? (prev.end - prev.start) * 0.5 : Math.max(0.05, prev ? n.start - prev.end : 0.4);
    if (pre > room) {
      const k = room / pre;
      pre *= k;
      ovl *= k;
    }
    return { n, e, pre, ovl, joined };
  });
  for (let i = 0; i < notes.length; i++) {
    const p = plan[i];
    if (!p) continue;
    const next = plan[i + 1];
    const nextJoined = next && next.joined;
    const segStart = p.n.start - p.pre;
    let segEnd = nextJoined ? next.n.start - next.pre + Math.max(0, next.ovl) : p.n.end + 0.04;
    if (segEnd <= p.n.start + 0.02) segEnd = p.n.start + 0.02;
    const s = await bank.sample(p.e.file, sr);
    const srcLen = s.data.length / sr;
    const off = p.e.offset / 1000;
    const cons = Math.max(0, p.e.consonant / 1000);
    let end = p.e.cutoff < 0 ? off - p.e.cutoff / 1000 : srcLen - p.e.cutoff / 1000;
    end = Math.min(srcLen, end);
    const cEnd = Math.min(off + cons, end - 0.01);
    if (end <= off + 0.02) continue;
    const outLen = Math.max(1, Math.round((segEnd - segStart) * sr));
    const consOut = cEnd - off;
    const vOut = Math.max(1e-3, (segEnd - segStart) - consOut);
    const vSrc = Math.max(1e-3, end - cEnd);
    // Output time -> source time: consonant as recorded, vowel stretched (or cut) to fit.
    const srcAt = (o) => {
      const tau = o / sr;
      const at = tau < consOut ? off + tau : cEnd + (vOut <= vSrc ? tau - consOut : ((tau - consOut) * vSrc) / vOut);
      return at * sr;
    };
    const f0At = (o) => midiToHz(pitch(segStart + o / sr));
    const seg = psola(s.data, s.marks, outLen, srcAt, f0At, sr);
    // Crossfades: in over the overlap with the note before, out over the next overlap.
    const fin = Math.max(Math.round(0.005 * sr), Math.round((p.joined ? Math.max(p.ovl, 0.01) : 0.005) * sr));
    const fout = Math.max(Math.round(0.01 * sr), Math.round((nextJoined ? Math.max(next.ovl, 0.01) : 0.03) * sr));
    const base = Math.round((segStart - phrase.start) * sr);
    const vel = 0.55 + 0.6 * p.n.vel;
    for (let k = 0; k < outLen; k++) {
      const o = base + k;
      if (o < 0 || o >= len) continue;
      let g = vel * (dyn(segStart + k / sr) / 100);
      if (k < fin) g *= k / fin;
      if (k > outLen - fout) g *= Math.max(0, (outLen - k) / fout);
      out[o] += seg[k] * g;
    }
  }
  return { data: out, missing };
}

// Vowel after a lyric, for VCV (exported for tests).
export const vowelOf = moraVowel;
