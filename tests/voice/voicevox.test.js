import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setFetch, listSingers, teacherOf, phraseScore, renderVoicevox, VV_FPS, cleanUrl } from '../../voice/src/voices/voicevox.js';
import { builtinHumanizer } from '../../voice/src/voices/humanizer.js';
import { encodeWav } from '../../voice/src/dsp.js';
import { newProject, makeNote, PPQ } from '../../voice/src/store.js';
import { makePhrases, pitchFn, curveFn } from '../../voice/src/phrase.js';

test('VOICEVOX engine protocol (mocked engine)', async () => {
  const calls = [];
  setFetch(async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const json = (j) => ({ ok: true, status: 200, json: async () => j });
    if (url.endsWith('/singers')) return json([{ name: '四国めたん', speaker_uuid: 'u', styles: [{ name: 'あまあま', id: 3000, type: 'frame_decode' }, { name: '歌唱指導', id: 6000, type: 'singing_teacher' }] }]);
    if (url.includes('/sing_frame_audio_query')) {
      const n = calls[calls.length - 1].body.notes.reduce((s, x) => s + x.frame_length, 0);
      return json({ f0: Array.from({ length: n }, (_, i) => (i > 20 ? 200 : 0)), volume: Array(n).fill(0.5), phonemes: [], volumeScale: 1, outputSamplingRate: 24000, outputStereo: false });
    }
    if (url.includes('/frame_synthesis')) return { ok: true, status: 200, arrayBuffer: async () => encodeWav(new Float32Array(24000).fill(0.1), 24000).buffer };
    return { ok: false, status: 404, json: async () => ({ detail: 'nope' }) };
  });
  const singers = await listSingers('http://localhost:50021/');
  assert.equal(singers[0].styles.length, 2);
  assert.equal(teacherOf(singers), 6000);
  const p = newProject();
  const tr = p.tracks[0];
  tr.notes = [makeNote(0, 60, PPQ, 'do'), makeNote(PPQ, 62, PPQ, 're')];
  const ph = makePhrases(tr, p)[0];
  const score = phraseScore(ph);
  assert.equal(score.notes[0].key, null);
  assert.deepEqual(score.notes.filter((n) => n.key !== null).map((n) => [n.key, n.lyric]), [[60, 'ド'], [62, 'レ']]);
  const total = score.notes.reduce((s, n) => s + n.frame_length, 0);
  assert.equal(total, Math.round((ph.end - ph.start) * VV_FPS) + score.lead);
  const r = await renderVoicevox(ph, { base: 'http://localhost:50021', speaker: 3000, teacher: 6000, pitch: pitchFn(ph.notes, tr, p.bpm), dyn: curveFn(tr, 'dyn', p.bpm) });
  assert.equal(r.data.length, Math.ceil((ph.end - ph.start) * 44100));
  const synth = calls.find((c) => c.url.includes('/frame_synthesis'));
  assert.ok(synth.url.endsWith('speaker=3000'));
  assert.ok(Math.abs(synth.body.f0[40] - 261.6) < 30); // our pitch replaced the engine's on voiced frames
  assert.equal(synth.body.f0[5], 0);
  assert.throws(() => cleanUrl('localhost'));
  setFetch(async () => { throw new Error('refused'); });
  await assert.rejects(listSingers('http://localhost:50021'), /not reachable/);
});

test('built-in humanizer stays small and smooth', () => {
  const notes = [{ start: 0, end: 1, key: 60, vib: { depth: 0 } }, { start: 1, end: 2.5, key: 67, vib: { depth: 0 } }];
  const h = builtinHumanizer(3);
  let max = 0;
  for (let t = 0; t < 2.5; t += 0.01) {
    const i = t < 1 ? 0 : 1;
    max = Math.max(max, Math.abs(h(t, notes, i)));
  }
  assert.ok(max > 0.05 && max < 1, 'max ' + max);
  assert.ok(h(1.02, notes, 1) > 0); // overshoot upward after the jump
});
