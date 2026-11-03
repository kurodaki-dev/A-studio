import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeWav, encodeWav, resample, pitchTrack, medianPitch, pitchMarks, psola } from '../../voice/src/dsp.js';

const SR = 44100;
// A voice-like tone: harmonics with a falling spectrum.
function tone(f0, sec, sr = SR) {
  const n = Math.round(sec * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let h = 1; h <= 12; h++) s += Math.sin((2 * Math.PI * f0 * h * i) / sr) / h;
    out[i] = 0.3 * s;
  }
  return out;
}

test('wav round trip and resampling', () => {
  const x = tone(220, 0.2);
  const back = decodeWav(encodeWav(x, SR));
  assert.equal(back.sr, SR);
  assert.equal(back.data.length, x.length);
  assert.ok(Math.abs(back.data[1000] - x[1000]) < 1e-3);
  const r = resample(x, SR, 22050);
  assert.ok(Math.abs(r.length - x.length / 2) <= 1);
  assert.ok(Math.abs(medianPitch(pitchTrack(r, 22050)) - 220) < 3);
  assert.throws(() => decodeWav(new Uint8Array(10)));
});

test('pitch detection', () => {
  for (const f of [110, 220, 440, 660]) {
    const p = medianPitch(pitchTrack(tone(f, 0.4), SR));
    assert.ok(Math.abs(p - f) / f < 0.01, f + ' -> ' + p);
  }
  assert.equal(medianPitch(pitchTrack(new Float32Array(SR / 4), SR)), 0);
});

test('psola changes pitch and length, keeps the timbre', () => {
  const src = tone(220, 0.5);
  const tr = pitchTrack(src, SR);
  const marks = pitchMarks(src, SR, tr);
  const outLen = SR; // 2x longer
  const out = psola(src, marks, outLen, (t) => (t / outLen) * src.length, () => 330, SR);
  assert.equal(out.length, outLen);
  const got = medianPitch(pitchTrack(out, SR));
  assert.ok(Math.abs(got - 330) / 330 < 0.015, 'pitch ' + got);
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak > 0.2 && peak < 1.2, 'level ' + peak);
});
