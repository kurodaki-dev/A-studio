import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBanks } from '../../voice/src/voices/library.js';

test('archive contents are recognized', () => {
  assert.deepEqual(detectBanks(['Singer/dsconfig.yaml', 'Singer/dsdur/dsconfig.yaml', 'Singer/dsvocoder/vocoder.yaml', 'Singer/acoustic.onnx']), [{ type: 'diffsinger', root: 'Singer' }]);
  assert.deepEqual(detectBanks(['nsf/vocoder.yaml', 'nsf/model.onnx']), [{ type: 'vocoder', root: 'nsf' }]);
  assert.deepEqual(detectBanks(['Teto/character.txt', 'Teto/A3/oto.ini', 'Teto/C4/oto.ini', 'Teto/A3/a.wav']), [{ type: 'utau', root: 'Teto' }]);
  assert.deepEqual(detectBanks(['oto.ini', 'a.wav']), [{ type: 'utau', root: '' }]);
  assert.deepEqual(detectBanks(['humanizer.onnx']), [{ type: 'humanizer', root: '', file: 'humanizer.onnx' }]);
  assert.deepEqual(detectBanks(['readme.txt']), []);
});
