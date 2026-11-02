import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fft, reduceNoise, removeHum, removeRumble, removeDC, reduceBreaths, normalizeLoudness, centerMask, toMono, removeClicks, repairClipping, spectrogram } from '../src/cleanup.js';
import { measureLoudness } from '../src/loudness.js';

const SR = 44100;
const sine = (f, sec, a = 0.5) => Float32Array.from({ length: Math.floor(SR * sec) }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / SR));
let seed = 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
const rms = (x, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / (b - a));
};
// Level of one frequency (DFT bin) in a signal.
const level = (x, f) => {
  let re = 0;
  let im = 0;
  for (let i = 0; i < x.length; i++) {
    re += x[i] * Math.cos((2 * Math.PI * f * i) / SR);
    im += x[i] * Math.sin((2 * Math.PI * f * i) / SR);
  }
  return (2 * Math.hypot(re, im)) / x.length;
};

test('FFT round trip', () => {
  const re = Float64Array.from({ length: 64 }, (_, i) => Math.sin(i) + (i % 3));
  const orig = re.slice();
  const im = new Float64Array(64);
  fft(re, im);
  fft(re, im, true);
  for (let i = 0; i < 64; i++) assert.ok(Math.abs(re[i] - orig[i]) < 1e-9);
});

test('noise reduction lowers the noise and keeps the voice', () => {
  // 1 s of noise only, then 2 s of tone with the same noise.
  const n = SR * 3;
  const noise = Float32Array.from({ length: n }, () => 0.05 * rnd());
  const x = new Float32Array(n);
  const tone = sine(440, 3, 0.4);
  for (let i = 0; i < n; i++) x[i] = noise[i] + (i >= SR ? tone[i] : 0);
  const [y] = reduceNoise([x], SR, [0, SR], 18);
  const before = rms(x, SR * 0.2, SR * 0.8);
  const after = rms(y, SR * 0.2, SR * 0.8);
  assert.ok(after < before * 0.25, 'noise ' + before.toFixed(4) + ' -> ' + after.toFixed(4));
  const keep = level(y.subarray(SR * 1.5, SR * 2.5), 440) / level(x.subarray(SR * 1.5, SR * 2.5), 440);
  assert.ok(keep > 0.85, 'tone kept ' + keep.toFixed(2));
  // Without a noise selection the quietest part is used.
  const [z] = reduceNoise([x], SR, null, 18);
  assert.ok(rms(z, SR * 0.2, SR * 0.8) < before * 0.3);
});

test('hum removal finds 50 or 60 Hz and removes it', () => {
  for (const f0 of [50, 60]) {
    const x = new Float32Array(SR * 2);
    const hum = [1, 2, 3].map((h) => sine(f0 * h, 2, 0.1 / h));
    const voice = sine(330, 2, 0.3);
    for (let i = 0; i < x.length; i++) x[i] = hum[0][i] + hum[1][i] + hum[2][i] + voice[i];
    const { base, channels } = removeHum([x], SR);
    assert.equal(base, f0);
    const y = channels[0].subarray(SR);
    assert.ok(level(y, f0) < 0.01, 'hum left ' + level(y, f0).toFixed(4));
    assert.ok(level(y, 330) > 0.28, 'voice ' + level(y, 330).toFixed(3));
  }
});

test('rumble and DC removal', () => {
  const x = new Float32Array(SR * 2);
  const low = sine(25, 2, 0.3);
  const mid = sine(1000, 2, 0.3);
  for (let i = 0; i < x.length; i++) x[i] = low[i] + mid[i] + 0.2;
  const [y] = removeRumble(removeDC([x]), SR, 80);
  const part = y.subarray(SR);
  assert.ok(level(part, 25) < 0.02, 'rumble ' + level(part, 25).toFixed(4));
  assert.ok(level(part, 1000) > 0.28);
  let mean = 0;
  for (const v of part) mean += v / part.length;
  assert.ok(Math.abs(mean) < 0.005);
});

test('breath reduction lowers the quiet parts only', () => {
  const x = new Float32Array(SR * 2);
  const loud = sine(300, 2, 0.5);
  for (let i = 0; i < x.length; i++) x[i] = i < SR ? loud[i] : 0.005 * rnd();
  const [y] = reduceBreaths([x], SR, 30, 12);
  assert.ok(rms(y, SR * 1.3, SR * 1.9) < rms(x, SR * 1.3, SR * 1.9) * 0.35);
  assert.ok(Math.abs(rms(y, SR * 0.2, SR * 0.8) / rms(x, SR * 0.2, SR * 0.8) - 1) < 0.02);
});

test('loudness normalization reaches -14 LUFS', () => {
  const x = sine(1000, 3, 0.05);
  const { channels } = normalizeLoudness([x, x.slice()], SR, -14);
  const r = measureLoudness(channels, SR);
  assert.ok(Math.abs(r.lufs + 14) < 0.3, 'got ' + r.lufs);
});

test('vocal removal and isolation work on the centre of a stereo mix', () => {
  // Centre: 440 Hz in both channels. Side: 660 Hz only on the left.
  const c = sine(440, 2, 0.3);
  const side = sine(660, 2, 0.3);
  const L = c.map((v, i) => v + side[i]);
  const R = c.slice();
  const [kl] = centerMask([L, R], false, SR);
  const [il] = centerMask([L, R], true, SR);
  const mid = (x) => x.subarray(SR * 0.5, SR * 1.5);
  assert.ok(level(mid(kl), 440) < 0.08, 'centre left in karaoke ' + level(mid(kl), 440).toFixed(3));
  assert.ok(level(mid(kl), 660) > 0.15, 'side kept in karaoke ' + level(mid(kl), 660).toFixed(3));
  assert.ok(level(mid(il), 440) > 0.2, 'centre kept ' + level(mid(il), 440).toFixed(3));
  assert.ok(level(mid(il), 660) < 0.1, 'side removed ' + level(mid(il), 660).toFixed(3));
  const m = toMono([L, R]);
  assert.equal(m[0][100], m[1][100]);
});

test('clicks are found and smoothed', () => {
  const x = sine(220, 1, 0.3);
  const clean = x.slice();
  for (const at of [5000, 15000, 30000]) x[at] += 0.8;
  const { channels, count } = removeClicks([x], SR, 0.5);
  assert.equal(count, 3);
  let worst = 0;
  for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs(channels[0][i] - clean[i]));
  assert.ok(worst < 0.05, 'error after repair ' + worst.toFixed(3));
  // A clean sine has no clicks.
  assert.equal(removeClicks([clean], SR, 0.5).count, 0);
});

test('clipping is redrawn and the level lowered', () => {
  const orig = sine(200, 0.5, 1.4);
  const clipped = orig.map((v) => Math.max(-1, Math.min(1, v)));
  const { channels, count } = repairClipping([clipped]);
  assert.ok(count > 50, 'runs ' + count);
  let peak = 0;
  for (const v of channels[0]) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak <= 0.98 + 1e-6);
  // The repaired wave is closer to the original shape than the clipped one.
  const corr = (a, b) => {
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
    return ab / Math.sqrt(aa * bb);
  };
  assert.ok(corr(channels[0], orig) > corr(clipped, orig), 'repair ' + corr(channels[0], orig).toFixed(4) + ' clipped ' + corr(clipped, orig).toFixed(4));
});

test('karaoke strength and spectrogram', () => {
  const c = sine(440, 1.5, 0.3);
  const L = c.slice();
  const R = c.slice();
  const [half] = centerMask([L, R], false, SR, 0.5);
  const [full] = centerMask([L, R], false, SR, 1);
  const mid = (x) => x.subarray(SR * 0.4, SR * 1.1);
  assert.ok(level(mid(full), 440) < level(mid(half), 440));
  const sp = spectrogram(sine(1000, 0.5), SR, 10, 40);
  assert.equal(sp.length, 10);
  const col = sp[5];
  const loudest = col.indexOf(Math.max(...col));
  const f = 40 * Math.pow(SR / 2 / 40, (loudest + 0.5) / 40);
  assert.ok(f > 800 && f < 1300, 'peak at ' + f.toFixed(0));
});
