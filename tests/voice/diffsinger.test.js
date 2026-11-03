import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openZip } from '../../voice/src/zip.js';
import { setOrtLoader, loadDiffSinger, renderDiffSinger, parseDsConfig, msToFrames, phonemize, checkVocoder, parseVocoderYaml, wordDivAndDur } from '../../voice/src/voices/diffsinger.js';
import { newProject, makeNote, PPQ } from '../../voice/src/store.js';
import { makePhrases, pitchFn, curveFn, midiToHz } from '../../voice/src/phrase.js';
import { pitchTrack, medianPitch } from '../../voice/src/dsp.js';

setOrtLoader(async () => {
  const ort = await import('onnxruntime-web');
  ort.env.wasm.numThreads = 1;
  return ort;
});

test('dsconfig, frames and vocoder checks', () => {
  const c = parseDsConfig('acoustic: a.onnx\nuse_key_shift_embed: true\naugmentation_args:\n  random_pitch_shifting:\n    range: [-5, 5]\nuse_shallow_diffusion: true\nmax_depth: 400\nmel_base: e\n');
  assert.equal(c.acoustic, 'a.onnx');
  assert.ok(c.useKeyShiftEmbed);
  assert.deepEqual(c.keyShiftRange, [-5, 5]);
  assert.ok(c.useVariableDepth);
  assert.equal(c.maxDepth, 0.4);
  assert.deepEqual(msToFrames([100, 100, 100], 11.61), [9, 9, 8]);
  const v = parseVocoderYaml('sample_rate: 44100\nhop_size: 512\nwin_size: 2048\nfft_size: 2048\nnum_mel_bins: 128\nmel_fmin: 40\nmel_fmax: 16000\nmel_base: e\nmel_scale: slaney\n');
  assert.deepEqual(checkVocoder(c, v), []);
  assert.deepEqual(checkVocoder(c, { ...v, hopSize: 256 }), ['hop size']);
});

test('DiffSinger bank renders through ONNX models at the note pitch', async () => {
  const z = openZip(readFileSync(new URL('./fixtures/diffsinger-test.zip', import.meta.url)));
  const src = { names: z.names, read: async (n) => z.read(n) };
  const bank = await loadDiffSinger(src, 'TestSinger');
  assert.equal(bank.name, 'Test Singer');
  assert.equal(bank.phonemes.get('a'), 2);
  assert.ok(bank.vocoder);
  const p = newProject();
  const tr = p.tracks[0];
  tr.notes = [makeNote(0, 60, PPQ * 2, 'ka'), makeNote(PPQ * 2, 64, PPQ * 2, 'la'), makeNote(PPQ * 4, 67, PPQ * 2, 'shi')];
  tr.notes.forEach((n) => { n.porta = 0; });
  const ph = makePhrases(tr, p)[0];
  assert.deepEqual(phonemize(bank, ph.notes[0]), ['k', 'a']);
  assert.deepEqual(phonemize(bank, ph.notes[1]), ['r', 'a']); // dictionary entry "la"
  const ctx = { bank, pitch: pitchFn(ph.notes, tr, p.bpm), dyn: curveFn(tr, 'dyn', p.bpm), gen: curveFn(tr, 'gen', p.bpm), steps: 10 };
  const { data, missing } = await renderDiffSinger(ph, ctx);
  assert.deepEqual(missing, []);
  const SR = 44100;
  const part = (a, c) => data.subarray(Math.round((a - ph.start) * SR), Math.round((c - ph.start) * SR));
  for (const [a, c, key] of [[0.3, 0.9, 60], [1.3, 1.9, 64], [2.3, 2.9, 67]]) {
    const f = medianPitch(pitchTrack(part(a, c), SR));
    assert.ok(Math.abs(f - midiToHz(key)) / midiToHz(key) < 0.02, key + ': ' + f);
  }
});

test('word divisions for the variance model (as OpenUtau)', () => {
  const isVowel = (p) => ['a', 'i', 'SP'].includes(p);
  // SP(head) k a SP(gap) s i SP(tail)
  const padded = [{ ph: 'SP', pad: true }, { ph: 'k' }, { ph: 'a' }, { ph: 'SP', pad: true }, { ph: 's' }, { ph: 'i' }, { ph: 'SP', pad: true }];
  const { div, dur } = wordDivAndDur(padded, [8, 4, 20, 5, 6, 30, 8], isVowel);
  assert.deepEqual(div, [2, 3, 1, 1]);
  assert.equal(div.reduce((a, b) => a + b, 0), padded.length);
  assert.deepEqual(dur, [12, 31, 30, 8]);
});
