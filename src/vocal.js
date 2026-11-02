import { detectKey } from './notetools.js';
import { instrumentCat } from './audio/catalog.js';

// Ready made effect chains for vocals, and chains saved by the user.
const KEY = 'astudio:chains';

export const VOCAL_CHAINS = [
  {
    id: 'clean',
    name: 'Clean vocal',
    fx: [
      { plugin: 'astudio-gate', params: { threshold: -50, release: 150 } },
      { plugin: 'astudio-deesser', params: { freq: 6500, threshold: -28, amount: 0.5 } },
      { plugin: 'astudio-compressor', params: { threshold: -20, ratio: 4, attack: 5, release: 120, makeup: 5 } },
      { plugin: 'astudio-reverb', params: { size: 1.8, damp: 0.3, predelay: 30, mix: 0.18 } },
    ],
  },
  {
    id: 'trap',
    name: 'Trap auto tune',
    fx: [
      { plugin: 'astudio-autotune', params: { key: 0, scale: 2, retune: 0, mix: 1 } },
      { plugin: 'astudio-compressor', params: { threshold: -22, ratio: 5, attack: 4, release: 100, makeup: 6 } },
      { plugin: 'astudio-echo', params: { time: 2, feedback: 0.4, tone: 0.5, mix: 0.22 } },
      { plugin: 'astudio-reverb', params: { size: 2.2, damp: 0.35, predelay: 25, mix: 0.2 } },
    ],
  },
  {
    id: 'rnb',
    name: 'R&B smooth',
    fx: [
      { plugin: 'astudio-autotune', params: { key: 0, scale: 1, retune: 120, mix: 1 } },
      { plugin: 'astudio-doubler', params: { width: 0.7, depth: 0.3, mix: 0.35 } },
      { plugin: 'astudio-compressor', params: { threshold: -18, ratio: 3, attack: 10, release: 160, makeup: 4 } },
      { plugin: 'astudio-reverb', params: { size: 3, damp: 0.4, predelay: 40, mix: 0.28 } },
    ],
  },
  {
    id: 'rap',
    name: 'Rap upfront',
    fx: [
      { plugin: 'astudio-gate', params: { threshold: -45, release: 100 } },
      { plugin: 'astudio-deesser', params: { freq: 6000, threshold: -30, amount: 0.7 } },
      { plugin: 'astudio-compressor', params: { threshold: -24, ratio: 6, attack: 3, release: 90, makeup: 7 } },
      { plugin: 'astudio-echo', params: { time: 3, feedback: 0.1, tone: 0.7, mix: 0.15 } },
    ],
  },
  {
    id: 'adlibs',
    name: 'Ad libs',
    fx: [
      { plugin: 'astudio-pitch', params: { semitones: 12, tone: 0, mix: 0.35 } },
      { plugin: 'astudio-filter', params: { type: 1, cutoff: 0.3, reso: 0.1 } },
      { plugin: 'astudio-echo', params: { time: 1, feedback: 0.5, tone: 0.5, mix: 0.35 } },
      { plugin: 'astudio-reverb', params: { size: 3.5, damp: 0.4, predelay: 50, mix: 0.35 } },
    ],
  },
  {
    id: 'radio',
    name: 'Radio voice',
    fx: [
      { plugin: 'astudio-filter', params: { type: 2, cutoff: 0.55, reso: 0.4 } },
      { plugin: 'astudio-distortion', params: { mode: 0, drive: 0.3, tone: 0.6, mix: 0.6 } },
      { plugin: 'astudio-compressor', params: { threshold: -20, ratio: 6, attack: 5, release: 100, makeup: 6 } },
    ],
  },
  {
    id: 'deep',
    name: 'Deep voice',
    fx: [
      { plugin: 'astudio-pitch', params: { semitones: -5, tone: -0.5, mix: 1 } },
      { plugin: 'astudio-compressor', params: { threshold: -20, ratio: 4, attack: 10, release: 150, makeup: 4 } },
      { plugin: 'astudio-reverb', params: { size: 1.2, damp: 0.5, predelay: 10, mix: 0.15 } },
    ],
  },
  {
    id: 'robot',
    name: 'Robot',
    fx: [
      { plugin: 'astudio-autotune', params: { key: 0, scale: 0, retune: 0, mix: 1 } },
      { plugin: 'astudio-robot', params: { freq: 60, mix: 0.7 } },
      { plugin: 'astudio-echo', params: { time: 3, feedback: 0.2, tone: 0.6, mix: 0.2 } },
    ],
  },
];

// Copy of a chain as mixer slots.
export const chainSlots = (chain) => chain.fx.map((f) => ({ plugin: f.plugin, on: true, params: { ...f.params } }));

export function userChains() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((c) => c && typeof c.name === 'string' && Array.isArray(c.fx)) : [];
  } catch {
    return [];
  }
}

export function saveUserChain(name, slots) {
  const list = userChains().filter((c) => c.name !== name);
  list.push({ name: name.slice(0, 40), fx: slots.slice(0, 4).map((f) => ({ plugin: f.plugin, params: { ...f.params } })) });
  localStorage.setItem(KEY, JSON.stringify(list.slice(-50)));
}

export function deleteUserChain(name) {
  try {
    localStorage.setItem(KEY, JSON.stringify(userChains().filter((c) => c.name !== name)));
  } catch {
    /* ignore */
  }
}

// Note name and cents off from a frequency, for the tuner. MIDI 60 is C5 (FL Studio naming).
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function noteOfFreq(f) {
  if (!(f > 0)) return null;
  const m = 69 + 12 * Math.log2(f / 440);
  const n = Math.round(m);
  return { midi: n, name: NAMES[((n % 12) + 12) % 12] + Math.floor(n / 12), cents: Math.round((m - n) * 100) };
}

// Pitch of a block of samples by autocorrelation (main thread, used by the tuner).
export function detectPitch(buf, sr) {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  if (Math.sqrt(rms / buf.length) < 0.01) return 0;
  const minLag = Math.floor(sr / 1100);
  const maxLag = Math.min(buf.length >> 1, Math.floor(sr / 60));
  const n = buf.length - maxLag;
  let best = -1;
  let bestV = 0;
  const corr = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < n; i++) {
      c += buf[i] * buf[i + lag];
      e1 += buf[i] * buf[i];
      e2 += buf[i + lag] * buf[i + lag];
    }
    const v = c / Math.sqrt(e1 * e2 || 1);
    corr[lag] = v;
    if (v > bestV) {
      bestV = v;
      best = lag;
    }
  }
  if (best < 0 || bestV < 0.8) return 0;
  // Prefer the first strong peak (avoids octave errors).
  for (let lag = minLag; lag < best; lag++) {
    if (corr[lag] > bestV * 0.92 && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
      best = lag;
      break;
    }
  }
  const a = corr[best - 1] || 0;
  const b = corr[best];
  const c = corr[best + 1] || 0;
  const den = a + c - 2 * b;
  const shift = den ? (a - c) / (2 * den) : 0;
  return sr / (best + shift);
}

// Key of the project from its melodic notes (drums are left out).
export function projectKey(project) {
  const all = [];
  for (const pt of project.patterns) for (const [cid, arr] of Object.entries(pt.notes)) {
    const c = project.channels.find((x) => x.id === cid);
    if (c && c.instrument !== 'sampler' && instrumentCat(c.instrument) !== 'drums') all.push(...arr);
  }
  return detectKey(all);
}
