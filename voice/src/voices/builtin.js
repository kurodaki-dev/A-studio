// Built-in voices (vocoder): a formant synthesizer that sings without any download.
// A glottal source at the wanted pitch goes through vowel formants; consonants are
// shaped noise and bursts. Not as natural as DiffSinger or UTAU, but always there.
import { moraPhonemes } from '../lyrics.js';
import { timeline, midiToHz } from '../phrase.js';

export const BUILTIN_VOICES = [
  { id: 'builtin:aria', name: 'Aria', desc: 'Built-in vocoder voice, bright', formant: 1.0, tilt: 3200, breath: 0.02, gain: 1 },
  { id: 'builtin:kumo', name: 'Kumo', desc: 'Built-in vocoder voice, deep', formant: 0.86, tilt: 2400, breath: 0.03, gain: 1.1 },
  { id: 'builtin:robo', name: 'Robo', desc: 'Built-in vocoder, robotic (fixed pitch shape)', formant: 0.95, tilt: 5000, breath: 0, gain: 0.9, robot: true },
];

const VOWELS = {
  a: [800, 1200, 2600], i: [300, 2300, 3000], u: [350, 1300, 2400], e: [480, 1900, 2600], o: [500, 850, 2600],
  N: [280, 1500, 2600],
};
// How each phoneme sounds: voiced amount, noise amount and band, formants, gain.
function shape(ph, nextVowel) {
  const b = ph.replace(/^[a-z]{2}\//, '');
  const nv = VOWELS[nextVowel] || VOWELS.a;
  if (VOWELS[b]) return { v: 1, n: 0, f: VOWELS[b], g: b === 'N' ? 0.55 : 1 };
  switch (b) {
    case 'n': case 'ny': return { v: 0.8, n: 0, f: [280, 1700, 2600], g: 0.5 };
    case 'm': case 'my': return { v: 0.8, n: 0, f: [280, 1100, 2400], g: 0.45 };
    case 'r': case 'ry': case 'l': return { v: 1, n: 0, f: [420, 1300, 2100], g: 0.7 };
    case 'y': return { v: 1, n: 0, f: VOWELS.i, g: 0.8 };
    case 'w': return { v: 1, n: 0, f: VOWELS.u, g: 0.8 };
    case 's': return { v: 0, n: 0.5, nb: [6500, 2.5], f: nv, g: 1 };
    case 'z': return { v: 0.4, n: 0.35, nb: [6000, 2.5], f: nv, g: 1 };
    case 'sh': return { v: 0, n: 0.5, nb: [3600, 2], f: nv, g: 1 };
    case 'j': return { v: 0.4, n: 0.35, nb: [3400, 2], f: nv, g: 1 };
    case 'h': case 'hy': return { v: 0, n: 0.35, nb: [nv[1], 1], f: nv, g: 1, asp: true };
    case 'f': case 'v': return { v: b === 'v' ? 0.4 : 0, n: 0.25, nb: [4500, 0.8], f: nv, g: 1 };
    case 'ts': return { v: 0, n: 0.5, nb: [6000, 2], f: nv, g: 1, burst: 0.4 };
    case 'ch': return { v: 0, n: 0.5, nb: [3500, 2], f: nv, g: 1, burst: 0.4 };
    case 'k': case 'ky': return { v: 0, n: 0.6, nb: [2200, 3], f: nv, g: 1, burst: 0.7 };
    case 'g': case 'gy': return { v: 0.3, n: 0.4, nb: [2000, 3], f: nv, g: 1, burst: 0.7 };
    case 't': return { v: 0, n: 0.6, nb: [4500, 2.5], f: nv, g: 1, burst: 0.75 };
    case 'd': return { v: 0.3, n: 0.4, nb: [4000, 2.5], f: nv, g: 1, burst: 0.75 };
    case 'p': case 'py': return { v: 0, n: 0.5, nb: [900, 1.5], f: nv, g: 1, burst: 0.75 };
    case 'b': case 'by': return { v: 0.3, n: 0.35, nb: [800, 1.5], f: nv, g: 1, burst: 0.75 };
    case 'cl': return { v: 0, n: 0, f: nv, g: 0 };
    case 'br': case 'AP': return { v: 0, n: 0.18, nb: [1600, 0.6], f: nv, g: 1 };
    default: return { v: 0.6, n: 0.1, nb: [3000, 1], f: nv, g: 0.6 };
  }
}

const isVowel = (p) => !!VOWELS[p];

function phonemesOf(n) {
  if (n.lyric === 'br') return ['br'];
  if (n.ph) return n.ph.split(/\s+/).filter(Boolean);
  return moraPhonemes(n.lyric);
}

// Renders a phrase: notes (from phrase.js), pitch(t) in MIDI, dyn/gen/bre/ten(t) curves.
export function renderBuiltin(phrase, { voice, pitch, dyn, gen, bre, ten, sr = 44100 }) {
  const v = BUILTIN_VOICES.find((x) => x.id === voice) || BUILTIN_VOICES[0];
  const notes = phrase.notes;
  const segs = timeline(notes, phonemesOf, isVowel);
  const len = Math.ceil((phrase.end - phrase.start) * sr);
  const out = new Float32Array(len);
  if (!segs.length) return out;
  // Shape of every segment, with the vowel that follows for consonant colour.
  const shapes = segs.map((s, i) => {
    let nv = 'a';
    for (let j = i; j < segs.length; j++) if (VOWELS[segs[j].ph]) { nv = segs[j].ph; break; }
    return shape(s.ph, nv);
  });
  const B = 32; // control block, samples
  let phase = 0;
  let saw = 0;
  let lp = 0;
  const fs = [VOWELS.a[0], VOWELS.a[1], VOWELS.a[2]];
  let vAmp = 0;
  let nAmp = 0;
  let gainS = 0;
  const bq = [0, 1, 2].map(() => ({ x1: 0, x2: 0, y1: 0, y2: 0, b0: 0, b2: 0, a1: 0, a2: 0 }));
  const nq = { x1: 0, x2: 0, y1: 0, y2: 0, b0: 0, b2: 0, a1: 0, a2: 0 };
  const setBP = (q, f, Q) => {
    const w0 = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
    const alpha = Math.sin(w0) / (2 * Q);
    const a0 = 1 + alpha;
    q.b0 = alpha / a0;
    q.b2 = -alpha / a0;
    q.a1 = (-2 * Math.cos(w0)) / a0;
    q.a2 = (1 - alpha) / a0;
  };
  const run = (q, x) => {
    const y = q.b0 * x + q.b2 * q.x2 - q.a1 * q.y1 - q.a2 * q.y2;
    q.x2 = q.x1;
    q.x1 = x;
    q.y2 = q.y1;
    q.y1 = y;
    return y;
  };
  let seed = 12345;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x3fffffff - 1;
  };
  let si = 0;
  const amps = [1, 0.55, 0.3];
  const bws = [90, 110, 170];
  for (let b0 = 0; b0 < len; b0 += B) {
    const t = phrase.start + b0 / sr;
    while (si + 1 < segs.length && segs[si + 1].start <= t) si++;
    const seg = segs[si];
    const inSeg = t >= seg.start && t < seg.end;
    const sh = shapes[si];
    const into = inSeg ? (t - seg.start) / Math.max(1e-3, seg.end - seg.start) : 1;
    // Targets for this block.
    const scale = v.formant * Math.pow(2, (-(gen(t) || 0) / 100) * 0.25);
    const ft = sh.f.map((f) => f * scale);
    let vT = inSeg ? sh.v : 0;
    let nT = inSeg ? sh.n : 0;
    if (inSeg && sh.burst) {
      // Stop: closure, then a short burst at the end of the segment.
      const open = into >= sh.burst;
      vT = open ? sh.v * 0.3 : sh.v * 0.6;
      nT = open ? sh.n * 1.6 : 0;
    }
    const n = notes[seg.note] || notes[0];
    const level = (inSeg ? sh.g : 0) * (dyn(t) / 100) * (0.4 + 0.75 * n.vel) * v.gain;
    const breath = v.breath + Math.max(0, bre(t)) / 100 * 0.35;
    const tension = ten(t) / 100;
    const tilt = v.tilt * Math.pow(2, tension);
    const f0 = midiToHz(v.robot ? Math.round(pitch(t)) : pitch(t));
    for (let k = 0; k < 3; k++) {
      fs[k] += (ft[k] - fs[k]) * 0.18;
      setBP(bq[k], fs[k], fs[k] / bws[k]);
    }
    if (sh.nb) setBP(nq, sh.asp ? fs[1] : sh.nb[0] * scale, sh.nb[1]);
    const lpk = 1 - Math.exp((-2 * Math.PI * tilt) / sr);
    const inc = f0 / sr;
    for (let j = 0; j < B && b0 + j < len; j++) {
      vAmp += (vT - vAmp) * 0.01;
      nAmp += (nT - nAmp) * 0.02;
      gainS += (level - gainS) * 0.004;
      phase += inc;
      if (phase >= 1) phase -= 1;
      // Saw with polyBLEP (fewer aliasing tones), then a tilt low-pass.
      let s = 2 * phase - 1;
      if (phase < inc) {
        const x = phase / inc;
        s -= x + x - x * x - 1;
      } else if (phase > 1 - inc) {
        const x = (phase - 1) / inc;
        s -= x * x + x + x + 1;
      }
      saw = s;
      lp += (saw - lp) * lpk;
      const src = lp * vAmp + noise() * breath * vAmp;
      let voiced = 0;
      for (let k = 0; k < 3; k++) voiced += run(bq[k], src) * amps[k];
      const nz = sh.nb ? run(nq, noise()) * nAmp : 0;
      out[b0 + j] = (voiced * 2 + nz * 1.2) * gainS;
    }
  }
  // Fade the edges of the phrase.
  const f = Math.min(256, len >> 2);
  for (let i = 0; i < f; i++) {
    out[i] *= i / f;
    out[len - 1 - i] *= i / f;
  }
  return out;
}
