// Phrases: the notes of a track cut where there is a rest, in seconds, with their lyrics
// turned into kana and phonemes, and the curves (pitch, dynamics...) of the voice.
import { PPQ, CURVE_INFO, curveAt, ticksToSec } from './store.js';
import { normalizeLyric, moraVowel } from './lyrics.js';

export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);

const PHRASE_GAP = 0.3; // seconds of rest that start a new phrase
export const PAD = 0.25; // seconds rendered before the first and after the last note

// Notes of a track as sung: lyrics normalized, "-" holds merged into the note before.
export function sungNotes(track, bpm) {
  const out = [];
  const sorted = [...track.notes].sort((a, b) => a.t - b.t);
  for (const n of sorted) {
    const lyric = normalizeLyric(n.lyric);
    if (lyric === 'R') continue;
    const start = ticksToSec(n.t, bpm);
    const end = ticksToSec(n.t + n.len, bpm);
    const prev = out[out.length - 1];
    const note = { id: n.id, raw: String(n.lyric == null ? '' : n.lyric).trim(), start, end, key: n.key, lyric, ph: n.ph || null, vel: n.vel == null ? 0.8 : n.vel, porta: (n.porta == null ? 80 : n.porta) / 1000, vib: n.vib || { depth: 0, rate: 5.5, delay: 0.35 }, tick: n.t, len: n.len, hold: lyric === '-' || lyric === '' };
    if (note.hold && prev && Math.abs(prev.end - start) < 0.02) {
      // A hold sings the vowel of the note before at a new pitch.
      note.lyric = prev.vowelLyric || prev.lyric;
    } else if (note.hold) {
      // Nothing to hold (first note or after a rest): sing "a".
      note.lyric = 'あ';
      note.hold = false;
    }
    note.vowel = note.hold && prev ? prev.vowel : moraVowel(note.lyric);
    note.vowelLyric = note.vowel ? { a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お', n: 'ん' }[note.vowel] : null;
    out.push(note);
  }
  return out;
}

// Cuts sung notes into phrases where the rest is long enough.
export function makePhrases(track, project) {
  const notes = sungNotes(track, project.bpm);
  const phrases = [];
  let cur = null;
  for (const n of notes) {
    if (!cur || n.start - cur.notes[cur.notes.length - 1].end > PHRASE_GAP) {
      cur = { notes: [] };
      phrases.push(cur);
    }
    cur.notes.push(n);
  }
  for (const ph of phrases) {
    ph.start = Math.max(0, ph.notes[0].start - PAD);
    ph.end = ph.notes[ph.notes.length - 1].end + PAD;
  }
  return phrases;
}

// Smooth S curve from 0 to 1.
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * x));

// Pitch in MIDI notes (fractional) at a time, from the notes: portamento into each note
// from the note before, vibrato after the delay, then the pitch bend curve.
export function pitchFn(notes, track, bpm, humanizer = null) {
  const bend = track.curves && track.curves.pit;
  return (t) => {
    let i = 0;
    while (i + 1 < notes.length && notes[i + 1].start <= t) i++;
    const n = notes[i];
    if (!n) return 60;
    let m = n.key;
    const prev = notes[i - 1];
    if (prev && n.porta > 0 && n.start - prev.end < 0.05 && t >= n.start - n.porta / 2) {
      // Glide centred slightly before the note start, like a singer.
      const x = (t - (n.start - n.porta / 2)) / n.porta;
      m = prev.key + (n.key - prev.key) * ease(x);
    } else if (t < n.start && prev) m = prev.key;
    const next = notes[i + 1];
    if (next && next.porta > 0 && next.start - n.end < 0.05 && t >= next.start - next.porta / 2) {
      const x = (t - (next.start - next.porta / 2)) / next.porta;
      m = n.key + (next.key - n.key) * ease(x);
    }
    // Vibrato: starts after `delay` of the note, fades in over 150 ms.
    const v = n.vib;
    if (v && v.depth > 0 && t >= n.start && t < n.end) {
      const len = n.end - n.start;
      const on = n.start + len * v.delay;
      if (t > on) {
        const fade = Math.min(1, (t - on) / 0.15) * Math.min(1, (n.end - t) / 0.05);
        m += ((v.depth / 100) * fade * Math.sin(2 * Math.PI * v.rate * (t - on)));
      }
    }
    if (bend && bend.length) m += curveAt(bend, (t * bpm * PPQ) / 60, 0) / 100;
    if (humanizer) m += humanizer(t, notes, i);
    return m;
  };
}

// Value of a track curve at a time (dynamics in %, the others -100..100).
export function curveFn(track, name, bpm) {
  const pts = track.curves && track.curves[name];
  const def = CURVE_INFO[name].def;
  return (t) => curveAt(pts, (t * bpm * PPQ) / 60, def);
}

// Note under a time (for dynamics per note), or null.
export function noteAt(notes, t) {
  for (const n of notes) if (t >= n.start - 0.02 && t < n.end + 0.05) return n;
  return null;
}

// Stable hash of what a phrase sounds like, for the render cache.
export function phraseKey(ph, track, project, extra = '') {
  const s = JSON.stringify([ph.notes.map((n) => [n.start, n.end, n.key, n.lyric, n.ph, n.vel, n.porta, n.vib]), track.voice, track.curves, track.humanize, track.steps, track.speaker, project.bpm, extra]);
  let h1 = 0x811c9dc5;
  let h2 = 0;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
    h2 = (h2 * 31 + s.charCodeAt(i)) | 0;
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

// Consonant types for timing (seconds before the vowel on the note start).
const CONS_TIME = {
  stop: 0.045, fricative: 0.085, affricate: 0.07, nasal: 0.055, liquid: 0.035, glide: 0.045, other: 0.05,
};
export function consonantType(p) {
  const b = p.replace(/^[a-z]{2}\//, '');
  if (/^(k|g|t|d|p|b|ky|gy|py|by|cl)$/.test(b)) return 'stop';
  if (/^(s|sh|z|h|hy|f|v|j|th|dh)$/.test(b)) return 'fricative';
  if (/^(ts|ch)$/.test(b)) return 'affricate';
  if (/^(n|m|ny|my|ng)$/.test(b)) return 'nasal';
  if (/^(r|ry|l)$/.test(b)) return 'liquid';
  if (/^(y|w)$/.test(b)) return 'glide';
  return 'other';
}
export const consonantTime = (p) => CONS_TIME[consonantType(p)];

// Phoneme timeline of a phrase: [{ ph, start, end, note }] in seconds. The vowel starts
// on the note, the consonants before it (taken from the end of the note or rest before).
// phonemesOf(note) gives the phonemes of a note; isVowel(ph) tells vowels apart.
export function timeline(notes, phonemesOf, isVowel) {
  const segs = [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const prev = notes[i - 1];
    const prevSeg = segs[segs.length - 1];
    const phs = phonemesOf(n, i);
    if (n.hold && prevSeg && Math.abs(prevSeg.end - n.start) < 0.03) {
      // Hold: the vowel before goes on.
      prevSeg.end = n.end;
      continue;
    }
    if (!phs.length) continue;
    let v = phs.findIndex((p) => isVowel(p));
    if (v < 0) v = phs.length - 1;
    const before = phs.slice(0, v);
    const after = phs.slice(v);
    // Room for the consonants: half of the note before, or the rest before.
    const room = prev ? (n.start - prev.end > 0.03 ? Math.min(0.3, n.start - prev.end) : (prev.end - prev.start) * 0.5) : 0.3;
    let need = before.reduce((s, p) => s + consonantTime(p), 0);
    const k = need > room ? room / need : 1;
    let t = n.start - need * k;
    if (prevSeg && t < prevSeg.end) prevSeg.end = Math.max(prevSeg.start + 0.01, t);
    for (const p of before) {
      const d = consonantTime(p) * k;
      segs.push({ ph: p, start: t, end: t + d, note: i });
      t += d;
    }
    // Vowel and what follows it share the note (a final consonant takes 20%).
    const len = n.end - n.start;
    if (after.length === 1) segs.push({ ph: after[0], start: n.start, end: n.end, note: i });
    else {
      const tail = Math.min(0.12, len * 0.2) / (after.length - 1);
      const vEnd = n.end - tail * (after.length - 1);
      segs.push({ ph: after[0], start: n.start, end: vEnd, note: i });
      let u = vEnd;
      for (const p of after.slice(1)) {
        segs.push({ ph: p, start: u, end: u + tail, note: i });
        u += tail;
      }
    }
  }
  return segs;
}
