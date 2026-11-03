import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('built-in AI humanizer model: loads, keeps the key, moves the pitch a little', async () => {
  const ort = await import('onnxruntime-web');
  ort.env.wasm.numThreads = 1;
  const s = await ort.InferenceSession.create(new Uint8Array(readFileSync(new URL('../../voice/src/models/humanizer.onnx', import.meta.url))));
  assert.deepEqual(s.inputNames, ['f0']);
  // Two notes (C4 then E4), 1 s each, at 100 frames per second.
  const T = 200;
  const run = async (shift) => {
    const f0 = Float32Array.from({ length: T }, (_, i) => (i < 100 ? 60 : 64) + shift);
    const r = await s.run({ f0: new ort.Tensor('float32', f0, [1, T]) });
    return { f0, out: r[s.outputNames[0]].data };
  };
  const a = await run(0);
  const b = await run(7);
  assert.equal(a.out.length, T);
  let maxDev = 0;
  let moved = 0;
  for (let i = 0; i < T; i++) {
    const d = a.out[i] - a.f0[i];
    maxDev = Math.max(maxDev, Math.abs(d));
    moved += Math.abs(d);
    // Same moves in another key.
    assert.ok(Math.abs((b.out[i] - b.f0[i]) - d) < 1e-3);
  }
  assert.ok(maxDev <= 1.5 && maxDev > 0.05, 'max ' + maxDev);
  assert.ok(moved / T > 0.01);
  // Around the jump the pitch is moved more than in the middle of a note.
  const near = Math.abs(a.out[100] - a.f0[100]) + Math.abs(a.out[95] - a.f0[95]);
  const mid = Math.abs(a.out[50] - a.f0[50]);
  assert.ok(near > mid, 'near ' + near + ' mid ' + mid);
});
