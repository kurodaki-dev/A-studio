import { test } from 'node:test';
import assert from 'node:assert/strict';
import { store, newProject, normalizeProject, serialize, makeNote, curveAt, drawCurve, PPQ, ticksToSec } from '../../voice/src/store.js';

test('project, curves and undo', () => {
  const p = newProject();
  p.tracks[0].notes.push(makeNote(0, 60, PPQ, 'か'));
  p.tracks[0].curves.pit = [[0, 0], [PPQ, 100]];
  const q = normalizeProject(JSON.parse(serialize(p)));
  assert.equal(q.tracks[0].notes[0].lyric, 'か');
  assert.equal(q.tracks[0].notes[0].vib.rate, 5.5);
  assert.equal(curveAt(q.tracks[0].curves.pit, PPQ / 2, 0), 50);
  assert.equal(curveAt([], 10, 7), 7);
  const c = drawCurve([[0, 0], [1000, 0]], 100, 10, 200, 20, 50);
  assert.deepEqual(c.map((x) => x[0]), [0, 100, 150, 200, 1000]);
  assert.throws(() => normalizeProject({}));
  assert.equal(ticksToSec(PPQ, 120), 0.5);
  store.load(p);
  store.change((pp) => { pp.tracks[0].notes[0].lyric = 'き'; });
  assert.equal(store.track().notes[0].lyric, 'き');
  store.undo();
  assert.equal(store.track().notes[0].lyric, 'か');
  store.redo();
  assert.equal(store.track().notes[0].lyric, 'き');
});
