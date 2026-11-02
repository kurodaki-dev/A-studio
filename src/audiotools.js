// Offline audio processing on Float32Array channels: BPM detection, time stretch
// that keeps the pitch (WSOLA) and the edits of the waveform editor.

// Tempo of a loop from the autocorrelation of its onset envelope. Returns BPM (70 to 180) or 0.
export function detectBpm(data, sr) {
  const hop = Math.round(sr * 0.01);
  const env = [];
  let prev = 0;
  for (let i = 0; i + hop <= data.length; i += hop) {
    let e = 0;
    for (let j = i; j < i + hop; j++) e += data[j] * data[j];
    e = Math.sqrt(e / hop);
    env.push(Math.max(0, e - prev));
    prev = e;
  }
  if (env.length < 200) return 0;
  const mean = env.reduce((a, b) => a + b, 0) / env.length;
  const x = env.map((v) => v - mean);
  let best = 0;
  let bestV = -Infinity;
  const fps = sr / hop;
  for (let bpm = 60; bpm <= 200; bpm += 0.5) {
    const lag = (60 / bpm) * fps;
    let v = 0;
    // Sum over the beat and its multiples, with linear interpolation of the lag.
    for (const mult of [1, 2, 4]) {
      const L = lag * mult;
      const l0 = Math.floor(L);
      const f = L - l0;
      let s = 0;
      for (let i = 0; i + l0 + 1 < x.length; i++) s += x[i] * (x[i + l0] * (1 - f) + x[i + l0 + 1] * f);
      v += s / mult;
    }
    if (v > bestV) {
      bestV = v;
      best = bpm;
    }
  }
  while (best < 70) best *= 2;
  while (best > 180) best /= 2;
  return Math.round(best * 10) / 10;
}

// Time stretch: factor = new length / old length, pitch unchanged (WSOLA).
export function timeStretch(channels, sr, factor) {
  const N = sr >= 44100 ? 2048 : 1024;
  const Hs = N / 2;
  const Ha = Hs / factor;
  const tol = Math.round(N / 4);
  const len = channels[0].length;
  const outLen = Math.max(1, Math.round(len * factor));
  const out = channels.map(() => new Float32Array(outLen + N));
  const norm = new Float32Array(outLen + N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const mono = new Float32Array(len);
  for (const c of channels) for (let i = 0; i < len; i++) mono[i] += c[i] / channels.length;
  let prevPos = 0;
  for (let k = 0, outPos = 0; outPos < outLen; k++, outPos += Hs) {
    let pos = Math.round(k * Ha);
    if (k > 0) {
      // Find the offset whose start best continues the previous frame.
      const natural = prevPos + Hs;
      let best = 0;
      let bestV = -Infinity;
      for (let d = -tol; d <= tol; d += 4) {
        const p = pos + d;
        if (p < 0 || p + Hs >= len) continue;
        let v = 0;
        for (let j = 0; j < Hs; j += 8) v += mono[p + j] * (mono[natural + j] || 0);
        if (v > bestV) {
          bestV = v;
          best = d;
        }
      }
      pos += best;
    }
    pos = Math.max(0, Math.min(len - 1, pos));
    for (let j = 0; j < N; j++) {
      const src = pos + j;
      if (src >= len) break;
      const w = win[j];
      for (let c = 0; c < channels.length; c++) out[c][outPos + j] += channels[c][src] * w;
      norm[outPos + j] += w;
    }
    prevPos = pos;
  }
  return out.map((o) => {
    const r = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) r[i] = norm[i] > 1e-3 ? o[i] / norm[i] : o[i];
    return r;
  });
}

// Waveform editor operations. a and b are sample indexes (a < b). Each returns new channels.
const range = (chs, a, b) => [Math.max(0, Math.min(a, b)), Math.min(chs[0].length, Math.max(a, b))];
export const EDITS = {
  silence(chs, a, b) {
    [a, b] = range(chs, a, b);
    return chs.map((c) => { const r = c.slice(); r.fill(0, a, b); return r; });
  },
  gain(chs, a, b, db) {
    [a, b] = range(chs, a, b);
    const g = Math.pow(10, db / 20);
    return chs.map((c) => { const r = c.slice(); for (let i = a; i < b; i++) r[i] *= g; return r; });
  },
  fadeIn(chs, a, b) {
    [a, b] = range(chs, a, b);
    return chs.map((c) => { const r = c.slice(); for (let i = a; i < b; i++) r[i] *= (i - a) / (b - a); return r; });
  },
  fadeOut(chs, a, b) {
    [a, b] = range(chs, a, b);
    return chs.map((c) => { const r = c.slice(); for (let i = a; i < b; i++) r[i] *= 1 - (i - a) / (b - a); return r; });
  },
  reverse(chs, a, b) {
    [a, b] = range(chs, a, b);
    return chs.map((c) => { const r = c.slice(); r.subarray(a, b).reverse(); return r; });
  },
  normalize(chs, a, b) {
    [a, b] = range(chs, a, b);
    let peak = 0;
    for (const c of chs) for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(c[i]));
    if (peak < 1e-6) return chs;
    return EDITS.gain(chs, a, b, 20 * Math.log10(0.97 / peak));
  },
  cut(chs, a, b) {
    [a, b] = range(chs, a, b);
    return chs.map((c) => { const r = new Float32Array(c.length - (b - a)); r.set(c.subarray(0, a)); r.set(c.subarray(b), a); return r; });
  },
  trim(chs, a, b) {
    [a, b] = range(chs, a, b);
    return chs.map((c) => c.slice(a, b));
  },
};
