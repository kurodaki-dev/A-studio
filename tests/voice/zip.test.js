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
