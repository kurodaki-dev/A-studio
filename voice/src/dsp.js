// Sound processing for A Voice Studio: WAV files, pitch detection (YIN), resampling
// and TD-PSOLA (pitch and time changes that keep the timbre), all offline.

export const SR = 44100;

// WAV (PCM 8/16/24/32 bits or float 32, any channel count) -> { sr, data: Float32Array (mono) }.
export function decodeWav(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (u8.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let fmt = null;
  let data = null;
  let o = 12;
  while (o + 8 <= u8.length) {
    const id = tag(o);
    const size = dv.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      fmt = { format: dv.getUint16(body, true), ch: dv.getUint16(body + 2, true), sr: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
      if (fmt.format === 0xfffe && size >= 26) fmt.format = dv.getUint16(body + 24, true);
    } else if (id === 'data') {
      data = { off: body, len: Math.min(size, u8.length - body) };
    }
    o = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('WAV file without format or data');
  const { ch, bits, format } = fmt;
  const bps = bits / 8;
  const frames = Math.floor(data.len / (bps * ch));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) {
      const p = data.off + (i * ch + c) * bps;
      let v = 0;
      if (format === 3 && bits === 32) v = dv.getFloat32(p, true);
      else if (format === 3 && bits === 64) v = dv.getFloat64(p, true);
      else if (bits === 16) v = dv.getInt16(p, true) / 32768;
      else if (bits === 8) v = (u8[p] - 128) / 128;
      else if (bits === 24) {
        let x = u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16);
        if (x & 0x800000) x |= ~0xffffff;
        v = x / 8388608;
      } else if (bits === 32) v = dv.getInt32(p, true) / 2147483648;
      s += v;
    }
    out[i] = s / ch;
  }
  return { sr: fmt.sr, data: out };
}

// Mono or stereo float data -> 16 bit WAV bytes.
export function encodeWav(channels, sr) {
  const chs = Array.isArray(channels) ? channels : [channels];
  const n = chs[0].length;
  const buf = new ArrayBuffer(44 + n * chs.length * 2);
  const dv = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  dv.setUint32(4, 36 + n * chs.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, chs.length, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * chs.length * 2, true);
  dv.setUint16(32, chs.length * 2, true);
  dv.setUint16(34, 16, true);
  w(36, 'data');
  dv.setUint32(40, n * chs.length * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (const c of chs) {
      const v = Math.max(-1, Math.min(1, c[i] || 0));
      dv.setInt16(o, v < 0 ? v * 32768 : v * 32767, true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}

// Cubic (Catmull-Rom) resampling.
export function resample(data, from, to) {
  if (from === to) return data;
  const n = Math.max(1, Math.floor((data.length * to) / from));
  const out = new Float32Array(n);
  const k = from / to;
  // Downsampling: a light low-pass first so the high frequencies do not fold back.
  let src = data;
  if (to < from) {
    const taps = Math.max(1, Math.round(from / to));
    src = new Float32Array(data.length);
    let acc = 0;
    for (let i = 0; i < data.length; i++) {
      acc += data[i];
      if (i >= taps) acc -= data[i - taps];
      src[i] = acc / Math.min(i + 1, taps);
    }
  }
  const at = (i) => src[Math.max(0, Math.min(src.length - 1, i))];
  for (let i = 0; i < n; i++) {
    const x = i * k;
    const i0 = Math.floor(x);
    const f = x - i0;
    const p0 = at(i0 - 1);
    const p1 = at(i0);
    const p2 = at(i0 + 1);
    const p3 = at(i0 + 2);
    out[i] = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
  }
  return out;
}

// Pitch track (YIN) every `hop` seconds: Float32Array of Hz, 0 where unvoiced.
// The analysis runs on a 4x decimated signal to stay fast.
export function pitchTrack(data, sr, { hop = 0.005, fmin = 70, fmax = 1000, threshold = 0.15 } = {}) {
  const dec = sr > 30000 ? 4 : sr > 15000 ? 2 : 1;
  const dsr = sr / dec;
  const x = new Float32Array(Math.floor(data.length / dec));
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    for (let j = 0; j < dec; j++) s += data[i * dec + j];
    x[i] = s / dec;
  }
  const maxTau = Math.min(Math.floor(dsr / fmin), 1024);
  const minTau = Math.max(2, Math.floor(dsr / fmax));
  const W = maxTau;
  const step = Math.max(1, Math.round(hop * dsr));
  const frames = Math.max(0, Math.floor((x.length - W - maxTau) / step) + 1);
  const out = new Float32Array(Math.max(1, Math.ceil(data.length / sr / hop)));
  const d = new Float32Array(maxTau + 1);
  for (let f = 0; f < frames; f++) {
    const o = f * step;
    let energy = 0;
    for (let i = 0; i < W; i++) energy += x[o + i] * x[o + i];
    if (energy / W < 1e-6) continue;
    d[0] = 1;
    let run = 0;
    let best = -1;
    for (let tau = 1; tau <= maxTau; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) {
        const v = x[o + i] - x[o + i + tau];
        s += v * v;
      }
      run += s;
      d[tau] = run > 0 ? (s * tau) / run : 1;
    }
    for (let tau = minTau; tau < maxTau; tau++) {
      if (d[tau] < threshold) {
        while (tau + 1 < maxTau && d[tau + 1] < d[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) continue;
    const a = d[best - 1];
    const b = d[best];
    const c = d[best + 1];
    const den = a - 2 * b + c;
    const t = den !== 0 ? best + (0.5 * (a - c)) / den : best;
    const idx = Math.round((o + W / 2) / dsr / hop);
    if (idx < out.length) out[idx] = dsr / t;
  }
  // Fill single gaps between voiced frames.
  for (let i = 1; i < out.length - 1; i++) if (!out[i] && out[i - 1] && out[i + 1]) out[i] = (out[i - 1] + out[i + 1]) / 2;
  return out;
}

// Median of the non-zero values (the pitch of a held vowel).
export function medianPitch(track, from = 0, to = track.length) {
  const v = [];
  for (let i = Math.max(0, from); i < Math.min(track.length, to); i++) if (track[i] > 0) v.push(track[i]);
  if (!v.length) return 0;
  v.sort((a, b) => a - b);
  return v[v.length >> 1];
}

// Analysis marks for PSOLA: one per pitch period where voiced, every 5 ms elsewhere.
export function pitchMarks(data, sr, track, hop = 0.005) {
  const marks = [];
  const uv = Math.round(sr * 0.005);
  let p = 0;
  while (p < data.length) {
    const f0 = track[Math.min(track.length - 1, Math.round(p / sr / hop))] || 0;
    if (f0 > 0) {
      const period = sr / f0;
      marks.push({ pos: p, period, voiced: true });
      p += period;
    } else {
      marks.push({ pos: p, period: uv, voiced: false });
      p += uv;
    }
  }
  return marks;
}

function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n);
  return w;
}
const hannCache = new Map();
const hannOf = (n) => {
  let w = hannCache.get(n);
  if (!w) {
    w = hann(n);
    if (hannCache.size > 400) hannCache.clear();
    hannCache.set(n, w);
  }
  return w;
};

// TD-PSOLA: builds `outLen` samples at `sr`. srcAt(outSample) gives the source position
// to read (time stretch), f0At(outSample) the wanted pitch in Hz (0 keeps the source).
export function psola(data, marks, outLen, srcAt, f0At, sr = SR) {
  const out = new Float32Array(outLen);
  const wsum = new Float32Array(outLen);
  if (!marks.length) return out;
  const positions = marks.map((m) => m.pos);
  const nearest = (x) => {
    let lo = 0;
    let hi = positions.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (positions[m] <= x) lo = m;
      else hi = m;
    }
    return Math.abs(positions[hi] - x) < Math.abs(positions[lo] - x) ? hi : lo;
  };
  let t = 0;
  while (t < outLen) {
    const m = marks[nearest(srcAt(t))];
    const P = Math.max(8, Math.round(m.period));
    const n = 2 * P;
    const w = hannOf(n);
    const s0 = Math.round(m.pos) - P;
    const o0 = Math.round(t) - P;
    for (let i = 0; i < n; i++) {
      const oi = o0 + i;
      if (oi < 0 || oi >= outLen) continue;
      const si = s0 + i;
      const v = si >= 0 && si < data.length ? data[si] : 0;
      out[oi] += v * w[i];
      wsum[oi] += w[i];
    }
    const f0 = m.voiced ? f0At(t) : 0;
    t += f0 > 0 ? sr / f0 : m.period;
  }
  for (let i = 0; i < outLen; i++) if (wsum[i] > 1e-3) out[i] /= Math.max(wsum[i], 0.5);
  return out;
}

// Short linear fades at both ends, to avoid clicks.
export function fadeEdges(data, n = 64) {
  const k = Math.min(n, data.length >> 1);
  for (let i = 0; i < k; i++) {
    const g = i / k;
    data[i] *= g;
    data[data.length - 1 - i] *= g;
  }
  return data;
}
