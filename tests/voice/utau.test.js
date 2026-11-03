import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { openZip } from '../../voice/src/zip.js';
import { encodeWav, pitchTrack, medianPitch } from '../../voice/src/dsp.js';
import { parseOto, parsePrefixMap, loadUtau, renderUtau, noteName } from '../../voice/src/voices/utau.js';
import { newProject, makeNote, PPQ } from '../../voice/src/store.js';
import { makePhrases, pitchFn, curveFn, midiToHz } from '../../voice/src/phrase.js';

const SR = 44100;
// A recording: 80 ms of noise (consonant) then a vowel at 200 Hz.
function rec(cons = 0.08, vowel = 0.6) {
  const n = Math.round((cons + vowel) * SR);
  const out = new Float32Array(n);
  let seed = 1;
  for (let i = 0; i < n; i++) {
    if (i < cons * SR) {
      seed = (seed * 16807) % 2147483647;
      out[i] = (seed / 2147483647 - 0.5) * 0.2;
    } else {
      let s = 0;
      for (let h = 1; h <= 10; h++) s += Math.sin((2 * Math.PI * 200 * h * i) / SR) / h;
      out[i] = 0.25 * s;
    }
  }
  return encodeWav(out, SR);
}
// Shift-JIS bytes of a few kana.
const SJ = { あ: [0x82, 0xa0], か: [0x82, 0xa9], さ: [0x82, 0xb3] };
const sj = (s) => [...s].flatMap((c) => SJ[c] || [c.charCodeAt(0)]);

function bank() {
  const line = (file, alias) => [...sj(file + '.wav='), ...sj(alias), ...sj(',20,80,-500,60,20\r\n')];
  const oto = new Uint8Array([...line('ka', '- か'), ...line('a_ka', 'a か'), ...line('sa', 'さ'), ...line('a', 'あ'), ...line('a_a', 'a あ')]);
  return zipSync({
    'Tester/character.txt': new TextEncoder().encode('name=Tester\nimage=icon.bmp\n'),
    'Tester/oto.ini': oto,
    'Tester/prefix.map': new TextEncoder().encode('C4\t\t\n'),
    'Tester/ka.wav': rec(), 'Tester/a_ka.wav': rec(), 'Tester/sa.wav': rec(0.1), 'Tester/a.wav': rec(0.01), 'Tester/a_a.wav': rec(0.01),
  });
}

test('oto.ini and prefix.map', () => {
  const e = parseOto('a.wav=,10,20,-300,40,5\nb.wav=- か,1,2,3,4,5\nbad line\n', 'sub');
  assert.equal(e.length, 2);
  assert.deepEqual(e[0], { file: 'sub/a.wav', alias: 'a', offset: 10, consonant: 20, cutoff: -300, preutter: 40, overlap: 5 });
  assert.equal(e[1].alias, '- か');
  assert.deepEqual(parsePrefixMap('C4\t\t_強\nD4\tx\t\n')['C4'], { prefix: '', suffix: '_強' });
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(61), 'C#4');
});

test('UTAU bank sings CV and VCV at the note pitch', async () => {
  const z = openZip(bank());
  const src = { names: z.names, read: async (n) => z.read(n) };
  const b = await loadUtau(src, 'Tester');
  assert.equal(b.name, 'Tester');
  assert.equal(b.lookup('か', null, 60).alias, '- か');
  assert.equal(b.lookup('か', 'a', 60).alias, 'a か');
  assert.equal(b.lookup('さ', 'a', 60).alias, 'さ');
  assert.equal(b.lookup('ka', null, 60, 'ka'), null);
  const p = newProject();
  const tr = p.tracks[0];
  tr.notes = [makeNote(0, 60, PPQ * 2, 'ka'), makeNote(PPQ * 2, 64, PPQ * 2, 'ka'), makeNote(PPQ * 4, 67, PPQ * 2, '-'), makeNote(PPQ * 6, 62, PPQ, 'zo')];
  tr.notes.forEach((n) => { n.porta = 0; });
  const ph = makePhrases(tr, p)[0];
  const { data, missing } = await renderUtau(ph, { bank: b, pitch: pitchFn(ph.notes, tr, p.bpm), dyn: curveFn(tr, 'dyn', p.bpm) });
  assert.deepEqual(missing, ['ぞ']);
  const part = (a, c) => data.subarray(Math.round((a - ph.start) * SR), Math.round((c - ph.start) * SR));
  for (const [a, c, key] of [[0.3, 0.9, 60], [1.3, 1.9, 64], [2.3, 2.9, 67]]) {
    const f = medianPitch(pitchTrack(part(a, c), SR));
    assert.ok(Math.abs(f - midiToHz(key)) / midiToHz(key) < 0.02, key + ': ' + f);
  }
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak > 0.1 && peak < 1.5, 'peak ' + peak);
});
