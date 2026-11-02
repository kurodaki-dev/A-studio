import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { unrarFiles } from '../src/rar.js';

const require = createRequire(import.meta.url);

test('RAR sample packs are read', async () => {
  const { createExtractorFromData } = require('node-unrar-js');
  const wasmBinary = readFileSync(require.resolve('node-unrar-js/dist/js/unrar.wasm'));
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/pack.rar', import.meta.url)));
  const out = await unrarFiles(bytes, (name) => /\.wav$/i.test(name), { createExtractorFromData, wasmBinary });
  assert.deepEqual(Object.keys(out).sort(), ['Pack/Kicks/kick.wav', 'Pack/snare.wav']);
  assert.equal(new TextDecoder().decode(out['Pack/snare.wav'].slice(0, 4)), 'RIFF');
  await assert.rejects(unrarFiles(new Uint8Array([1, 2, 3, 4]), () => true, { createExtractorFromData, wasmBinary }));
});
