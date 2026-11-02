// Integrated loudness (LUFS, ITU-R BS.1770 with gating) and sample peak.
function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

// K weighting: high shelf (head) then high pass (RLB), for any sample rate.
export function kWeight(x, sr) {
  let K = Math.tan((Math.PI * 1681.974450955533) / sr);
  const Vh = Math.pow(10, 3.999843853973347 / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let Q = 0.7071752369554196;
  let a0 = 1 + K / Q + K * K;
  const s = biquad(x, (Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  K = Math.tan((Math.PI * 38.13547087602444) / sr);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  return biquad(s, 1 / a0, -2 / a0, 1 / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
}

// channels: Float32Array per channel. Returns { lufs, peakDb } (lufs is -Infinity for silence).
export function measureLoudness(channels, sr) {
  const k = channels.map((c) => kWeight(c, sr));
  const block = Math.round(sr * 0.4);
  const hop = Math.round(sr * 0.1);
  const zs = [];
  for (let start = 0; start + block <= k[0].length; start += hop) {
    let z = 0;
    for (const c of k) {
      let sum = 0;
      for (let i = start; i < start + block; i++) sum += c[i] * c[i];
      z += sum / block;
    }
    zs.push(z);
  }
  const L = (z) => -0.691 + 10 * Math.log10(z);
  const abs = zs.filter((z) => z > 0 && L(z) > -70);
  let lufs = -Infinity;
  if (abs.length) {
    const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
    const gated = abs.filter((z) => L(z) > rel);
    if (gated.length) lufs = L(gated.reduce((a, b) => a + b, 0) / gated.length);
  }
  let peak = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  return { lufs, peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity };
}

export const LOUDNESS_TARGETS = [
  { name: 'Spotify, YouTube, Tidal', lufs: -14 },
  { name: 'Apple Music', lufs: -16 },
  { name: 'SoundCloud, loud rap and club', lufs: -9 },
];
