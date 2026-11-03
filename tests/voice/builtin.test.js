import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, makeNote, PPQ } from '../../voice/src/store.js';
import { makePhrases, pitchFn, curveFn, midiToHz } from '../../voice/src/phrase.js';
import { renderBuiltin } from '../../voice/src/voices/builtin.js';
import { pitchTrack, medianPitch } from '../../voice/src/dsp.js';

test('built-in vocoder voice sings the notes at their pitch', () => {
  const p = newProject();
  const tr = p.tracks[0];
  tr.notes = [makeNote(0, 60, PPQ * 2, 'ka'), makeNote(PPQ * 2, 64, PPQ * 2, 'sa'), makeNote(PPQ * 4, 67, PPQ * 2, '-')];
  tr.notes.forEach((n) => { n.porta = 0; });
  const phrases = makePhrases(tr, p);
  assert.equal(phrases.length, 1);
  const ph = phrases[0];
  assert.equal(ph.notes[2].lyric, 'あ'); // the hold sings the vowel of "sa"
  const ctx = { voice: 'builtin:aria', pitch: pitchFn(ph.notes, tr, p.bpm), dyn: curveFn(tr, 'dyn', p.bpm), gen: curveFn(tr, 'gen', p.bpm), bre: curveFn(tr, 'bre', p.bpm), ten: curveFn(tr, 'ten', p.bpm) };
  const out = renderBuiltin(ph, ctx);
  assert.equal(out.length, Math.ceil((ph.end - ph.start) * 44100));
  const sr = 44100;
  const part = (a, b) => out.subarray(Math.round((a - ph.start) * sr), Math.round((b - ph.start) * sr));
  // Middle of each note (0.5 s per beat at 120 BPM): pitch within 2%.
  for (const [a, b, key] of [[0.3, 0.9, 60], [1.3, 1.9, 64], [2.3, 2.9, 67]]) {
    const f = medianPitch(pitchTrack(part(a, b), sr));
    assert.ok(Math.abs(f - midiToHz(key)) / midiToHz(key) < 0.02, key + ': ' + f);
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak > 0.05 && peak < 1.5, 'peak ' + peak);
  assert.ok(out.every(Number.isFinite));
});
