import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import { decodeText, openZip } from '../../voice/src/zip.js';

test('texts and names in Shift-JIS or UTF-8', () => {
  const sjis = new Uint8Array([0x82, 0xa0, 0x2e, 0x77, 0x61, 0x76]); // "あ.wav" in Shift-JIS
  assert.equal(decodeText(sjis), 'あ.wav');
  assert.equal(decodeText(new TextEncoder().encode('﻿か.wav=か,1,2,3,4,5')), 'か.wav=か,1,2,3,4,5');
  // A ZIP whose names are Shift-JIS bytes without the UTF-8 flag (made on Japanese Windows).
  const z = zipSync({ ['bank/' + String.fromCharCode(...sjis)]: new Uint8Array([1, 2, 3]), 'bank/oto.ini': new TextEncoder().encode('x') });
  const zip = openZip(z);
  assert.ok(zip.names.includes('bank/oto.ini'));
  assert.ok(zip.names.includes('bank/あ.wav'));
  assert.deepEqual([...zip.read('bank/あ.wav')], [1, 2, 3]);
  const real = readFileSync(new URL('./fixtures/diffsinger-test.zip', import.meta.url));
  const ds = openZip(real);
  assert.ok(ds.names.includes('TestSinger/dsconfig.yaml'));
  assert.ok(decodeText(ds.read('TestSinger/dsconfig.yaml')).includes('acoustic.onnx'));
  assert.equal(ds.read('nope'), null);
});

test('a ZIP is read straight from a Blob (big voicebanks), entry by entry', async () => {
  const { openZipBlob } = await import('../../voice/src/zip.js');
  const big = new Uint8Array(3e6).map((_, i) => (i * 7) % 251);
  const z = zipSync({ 'Bank/model.onnx': [big, { level: 0 }], 'Bank/あ.wav': new Uint8Array([9, 8, 7]), 'Bank/dsconfig.yaml': new TextEncoder().encode('acoustic: model.onnx\n'.repeat(500)) });
  const zip = await openZipBlob(new Blob([z]));
  assert.deepEqual(zip.names.sort(), ['Bank/dsconfig.yaml', 'Bank/model.onnx', 'Bank/あ.wav']);
  assert.equal((await zip.read('Bank/model.onnx')).length, 3e6);
  assert.deepEqual([...(await zip.read('Bank/あ.wav'))], [9, 8, 7]);
  assert.ok(decodeText(await zip.read('Bank/dsconfig.yaml')).startsWith('acoustic: model.onnx'));
  assert.equal(await zip.read('nope'), null);
  await assert.rejects(openZipBlob(new Blob([new Uint8Array(50)])), /Not a ZIP/);
});
