// Audio clean up on Float32Array channels (offline, on clips and takes):
// noise reduction (spectral gating), hum removal, rumble and DC removal, breath
// reduction, loudness normalization, vocal removal or isolation, mono.
import { measureLoudness } from './loudness.js';

// In place radix 2 FFT. re and im have a power of two length. inverse divides by n.
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

const N = 2048;
const HOP = 512;
const WIN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));

// Short time Fourier transform frames of one channel: [{ re, im }].
function stft(x) {
  const frames = [];
  for (let start = -N + HOP; start < x.length; start += HOP) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const j = start + i;
      if (j >= 0 && j < x.length) re[i] = x[j] * WIN[i];
    }
    fft(re, im);
    frames.push({ start, re, im });
  }
  return frames;
}

// Overlap add of processed frames (Hann analysis and synthesis, normalized).
function istft(frames, length) {
  const out = new Float64Array(length);
  const norm = new Float64Array(length);
  for (const f of frames) {
    fft(f.re, f.im, true);
    for (let i = 0; i < N; i++) {
      const j = f.start + i;
      if (j < 0 || j >= length) continue;
      out[j] += f.re[i] * WIN[i];
      norm[j] += WIN[i] * WIN[i];
    }
  }
  const r = new Float32Array(length);
  for (let i = 0; i < length; i++) r[i] = norm[i] > 1e-6 ? out[i] / norm[i] : 0;
  return r;
}

const mag = (f, k) => Math.hypot(f.re[k], f.im[k]);

// Noise reduction. noise: [a, b] sample range of noise only, or null to use the
// quietest tenth of the clip. strength: reduction in dB (6 light, 12 medium, 20 strong).
export function reduceNoise(channels, sr, noise = null, strength = 12) {
  return channels.map((x) => {
    const frames = stft(x);
    const H = N / 2 + 1;
    let pick;
    if (noise && noise[1] - noise[0] > N) {
      pick = frames.filter((f) => f.start >= noise[0] - HOP && f.start + N <= noise[1] + HOP);
    } else {
      const energy = frames.map((f, i) => {
        let e = 0;
        for (let k = 1; k < H; k++) e += f.re[k] * f.re[k] + f.im[k] * f.im[k];
        return [e, i];
      }).filter(([e]) => e > 0).sort((a, b) => a[0] - b[0]);
      pick = energy.slice(0, Math.max(1, Math.ceil(energy.length / 10))).map(([, i]) => frames[i]);
    }
    if (!pick.length) return x.slice();
    // Noise power per bin, and a Wiener gain driven by a smoothed estimate of the
    // signal to noise ratio (decision directed): less "musical noise" than a plain
    // subtraction.
    const np = new Float64Array(H);
    for (const f of pick) for (let k = 0; k < H; k++) np[k] += (f.re[k] * f.re[k] + f.im[k] * f.im[k]) / pick.length;
    const over = Math.pow(10, (strength - 6) / 20) * 1.5;
    const floor = Math.pow(10, -strength / 20);
    const alpha = 0.96;
    const prevS = new Float64Array(H);
    for (const f of frames) {
      const g = new Float64Array(H);
      for (let k = 0; k < H; k++) {
        const p = f.re[k] * f.re[k] + f.im[k] * f.im[k];
        const n = np[k] * over + 1e-12;
        const post = p / n;
        const prio = alpha * (prevS[k] / n) + (1 - alpha) * Math.max(0, post - 1);
        const gain = Math.max(floor, prio / (1 + prio));
        g[k] = gain;
        prevS[k] = gain * gain * p;
      }
      for (let k = 0; k < H; k++) {
        const v = (g[Math.max(0, k - 1)] + 2 * g[k] + g[Math.min(H - 1, k + 1)]) / 4;
        f.re[k] *= v;
        f.im[k] *= v;
        if (k > 0 && k < N / 2) {
          f.re[N - k] *= v;
          f.im[N - k] *= v;
        }
      }
    }
    return istft(frames, x.length);
  });
}

function biquad(x, c) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}
function notchCoef(f, q, sr) {
  const w = (2 * Math.PI * f) / sr;
  const al = Math.sin(w) / (2 * q);
  const a0 = 1 + al;
  return { b0: 1 / a0, b1: (-2 * Math.cos(w)) / a0, b2: 1 / a0, a1: (-2 * Math.cos(w)) / a0, a2: (1 - al) / a0 };
}
function highpassCoef(f, sr, q = 0.7071) {
  const w = (2 * Math.PI * f) / sr;
  const al = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + al;
  return { b0: (1 + c) / 2 / a0, b1: -(1 + c) / a0, b2: (1 + c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - al) / a0 };
}

// Energy at a frequency (Goertzel), for the hum detection.
function tone(x, f, sr) {
  const k = 2 * Math.cos((2 * Math.PI * f) / sr);
  let s1 = 0, s2 = 0;
  const n = Math.min(x.length, sr * 4);
  for (let i = 0; i < n; i++) {
    const s = x[i] + k * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return s1 * s1 + s2 * s2 - k * s1 * s2;
}

// Hum removal: notches on 50 or 60 Hz and 7 harmonics. base: 50, 60, or 0 for automatic.
export function removeHum(channels, sr, base = 0) {
  let f0 = base;
  if (!f0) {
    const mono = channels[0];
    f0 = tone(mono, 60, sr) + tone(mono, 120, sr) > tone(mono, 50, sr) + tone(mono, 100, sr) ? 60 : 50;
  }
  return {
    base: f0,
    channels: channels.map((x) => {
      let y = x;
      for (let h = 1; h <= 8 && f0 * h < sr / 2; h++) y = biquad(y, notchCoef(f0 * h, 30, sr));
      return y;
    }),
  };
}

// Rumble removal: 24 dB per octave high pass (two biquads).
export function removeRumble(channels, sr, freq = 80) {
  return channels.map((x) => biquad(biquad(x, highpassCoef(freq, sr)), highpassCoef(freq, sr)));
}

export function removeDC(channels) {
  return channels.map((x) => {
    let mean = 0;
    for (let i = 0; i < x.length; i++) mean += x[i] / x.length;
    return x.map((v) => v - mean);
  });
}

// Breath and noise between phrases: parts more than `below` dB under the loudest
// part are lowered by `cut` dB, with smooth fades.
export function reduceBreaths(channels, sr, below = 30, cut = 12) {
  const n = channels[0].length;
  const win = Math.max(1, Math.round(sr * 0.02));
  const env = new Float32Array(n);
  let sum = 0;
  const sq = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const c of channels) v += c[i] * c[i];
    sq[i] = v / channels.length;
  }
  for (let i = 0; i < n; i++) {
    sum += sq[i];
    if (i >= win) sum -= sq[i - win];
    env[i] = Math.sqrt(Math.max(0, sum) / Math.min(i + 1, win));
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, env[i]);
  const th = peak * Math.pow(10, -below / 20);
  const low = Math.pow(10, -cut / 20);
  const g = new Float32Array(n);
  let cur = 1;
  const att = 1 - Math.exp(-1 / (sr * 0.005));
  const rel = 1 - Math.exp(-1 / (sr * 0.08));
  // Look ahead 10 ms so the start of a word is not cut.
  const ahead = Math.round(sr * 0.01);
  for (let i = 0; i < n; i++) {
    const want = env[Math.min(n - 1, i + ahead)] > th ? 1 : low;
    cur += (want - cur) * (want > cur ? att : rel);
    g[i] = cur;
  }
  return channels.map((c) => c.map((v, i) => v * g[i]));
}

// Gain to reach a loudness (LUFS), keeping the peak under -1 dBFS.
export function normalizeLoudness(channels, sr, target = -14) {
  const { lufs, peakDb } = measureLoudness(channels, sr);
  if (!Number.isFinite(lufs)) return { channels, gainDb: 0 };
  const gainDb = Math.min(target - lufs, -1 - peakDb);
  const g = Math.pow(10, gainDb / 20);
  return { channels: channels.map((c) => c.map((v) => v * g)), gainDb };
}

// Vocal removal or isolation from a stereo mix: a spectral mask keeps the parts that
// are the same in both channels (centre, usually the voice) or removes them.
export function centerMask(channels, keepCenter, sr = 44100, strength = 1) {
  if (channels.length < 2) return channels.map((c) => c.slice());
  const [L, R] = channels;
  const fl = stft(L);
  const fr = stft(R);
  const H = N / 2 + 1;
  let prev = null;
  for (let i = 0; i < fl.length; i++) {
    const a = fl[i];
    const b = fr[i];
    const m = new Float64Array(H);
    for (let k = 0; k < H; k++) {
      const diff = Math.hypot(a.re[k] - b.re[k], a.im[k] - b.im[k]);
      const sum = mag(a, k) + mag(b, k);
      const centre = sum > 1e-9 ? Math.max(0, 1 - diff / sum) : 0;
      const freq = (k * sr) / N;
      if (keepCenter) m[k] = Math.pow(centre, 2 + 4 * strength);
      // Low end (under ~150 Hz) is left alone: bass and kick are usually centred too.
      else m[k] = freq < 150 ? 1 : 1 - strength * centre * centre;
    }
    // Smooth the mask over neighbouring bins and frames: fewer artifacts.
    const sm = new Float64Array(H);
    for (let k = 0; k < H; k++) {
      const v = (m[Math.max(0, k - 1)] + 2 * m[k] + m[Math.min(H - 1, k + 1)]) / 4;
      sm[k] = prev ? 0.6 * v + 0.4 * prev[k] : v;
    }
    prev = sm;
    for (const f of [a, b]) {
      for (let k = 0; k < H; k++) {
        f.re[k] *= sm[k];
        f.im[k] *= sm[k];
        if (k > 0 && k < N / 2) {
          f.re[N - k] *= sm[k];
          f.im[N - k] *= sm[k];
        }
      }
    }
  }
  return [istft(fl, L.length), istft(fr, R.length)];
}

// Clicks and pops: samples whose second difference jumps far above the local level
// are replaced by a smooth curve. sensitivity 0..1. Returns { channels, count }.
export function removeClicks(channels, sr, sensitivity = 0.5) {
  const k = 14 - sensitivity * 9;
  const win = Math.max(64, Math.round(sr * 0.01));
  let count = 0;
  const out = channels.map((x) => {
    const y = x.slice();
    const d = new Float32Array(x.length);
    for (let i = 2; i < x.length; i++) d[i] = x[i] - 2 * x[i - 1] + x[i - 2];
    let acc = 0;
    let skip = 0;
    const sq = d.map((v) => v * v);
    for (let i = 0; i < x.length; i++) {
      // The running sum is updated on every sample, also inside a repaired click.
      acc += sq[i];
      if (i >= win) acc -= sq[i - win];
      if (i < skip) continue;
      const level = Math.sqrt(Math.max(acc, 0) / Math.min(i + 1, win)) + 1e-5;
      if (Math.abs(d[i]) > k * level && i > 8 && i < x.length - 8) {
        const a = i - 4;
        const b = i + 4;
        const ma = (y[a] - y[a - 2]) / 2;
        const mb = (y[b + 2] - y[b]) / 2;
        for (let j = a + 1; j < b; j++) {
          const t = (j - a) / (b - a);
          const t2 = t * t;
          const t3 = t2 * t;
          y[j] = (2 * t3 - 3 * t2 + 1) * y[a] + (t3 - 2 * t2 + t) * ma * (b - a) + (-2 * t3 + 3 * t2) * y[b] + (t3 - t2) * mb * (b - a);
        }
        count += 1;
        skip = b + 1;
      }
    }
    return y;
  });
  return { channels: out, count };
}

// Clipping repair: flat runs at the peak are redrawn with a curve that follows the
// slopes around them, then the level is lowered so nothing clips. Returns { channels, count }.
export function repairClipping(channels) {
  let peak = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  if (peak < 0.2) return { channels: channels.map((c) => c.slice()), count: 0 };
  const th = peak * 0.985;
  let count = 0;
  const out = channels.map((x) => {
    const y = Float32Array.from(x);
    for (let i = 2; i < x.length - 3; i++) {
      if (Math.abs(x[i]) < th) continue;
      let j = i;
      while (j < x.length - 3 && Math.abs(x[j]) >= th && Math.sign(x[j]) === Math.sign(x[i])) j++;
      if (j - i >= 2) {
        const a = i - 1;
        const b = j;
        const ma = x[a] - x[a - 1];
        const mb = x[b + 1] - x[b];
        const n = b - a;
        for (let q = a + 1; q < b; q++) {
          const t = (q - a) / n;
          const t2 = t * t;
          const t3 = t2 * t;
          y[q] = (2 * t3 - 3 * t2 + 1) * x[a] + (t3 - 2 * t2 + t) * ma * n + (-2 * t3 + 3 * t2) * x[b] + (t3 - t2) * mb * n;
        }
        count += 1;
      }
      i = j;
    }
    return y;
  });
  let np = 0;
  for (const c of out) for (let i = 0; i < c.length; i++) np = Math.max(np, Math.abs(c[i]));
  if (np > 0.98) for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= 0.98 / np;
  return { channels: out, count };
}

// Magnitudes in dB for the spectrum view: `cols` columns of `rows` log spaced bins.
export function spectrogram(x, sr, cols, rows) {
  const out = [];
  const n = 1024;
  const w = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  for (let c = 0; c < cols; c++) {
    const start = Math.floor((c / cols) * Math.max(1, x.length - n));
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = (x[start + i] || 0) * w[i];
    fft(re, im);
    const col = new Float32Array(rows);
    for (let r = 0; r < rows; r++) {
      const f0 = 40 * Math.pow(sr / 2 / 40, r / rows);
      const f1 = 40 * Math.pow(sr / 2 / 40, (r + 1) / rows);
      let m = 0;
      for (let k = Math.floor((f0 * n) / sr); k <= Math.ceil((f1 * n) / sr) && k < n / 2; k++) m = Math.max(m, Math.hypot(re[k], im[k]));
      col[r] = 20 * Math.log10(m / (n / 4) + 1e-9);
    }
    out.push(col);
  }
  return out;
}

export function toMono(channels) {
  const n = channels[0].length;
  const m = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) m[i] += c[i] / channels.length;
  return channels.map(() => m.slice());
}

// One tap voice clean up: DC, rumble, noise reduction (auto profile), breaths, -14 LUFS.
export function cleanVoice(channels, sr) {
  let c = removeDC(channels);
  c = removeRumble(c, sr, 80);
  c = reduceNoise(c, sr, null, 12);
  c = reduceBreaths(c, sr, 35, 8);
  return normalizeLoudness(c, sr, -14).channels;
}
