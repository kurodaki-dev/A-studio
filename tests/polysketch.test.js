import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEP, BEAT } from '../src/constants.js';
import { polyLimit, channelNotes } from '../src/channelfx.js';
import { sketchToNotes, inScale } from '../src/notetools.js';
import { newProject, normalizeProject, serialize } from '../src/store.js';

const n = (t, key, len = BEAT) => ({ t, key, len, vel: 0.8 });

test('max polyphony cuts the oldest note', () => {
  const out = polyLimit([n(0, 60, BEAT * 4), n(STEP, 64, BEAT * 4), n(2 * STEP, 67, BEAT * 4)], 2);
  assert.equal(out.length, 3);
  assert.equal(out[0].len, 2 * STEP); // cut when the third note starts
  assert.equal(out[1].len, BEAT * 4);
  // A chord of 4 with max 3 keeps the 3 highest notes
  const chord = polyLimit([n(0, 60), n(0, 64), n(0, 67), n(0, 72)], 3);
  assert.deepEqual(chord.map((x) => x.key).sort(), [64, 67, 72]);
  assert.equal(polyLimit([n(0, 60)], 0).length, 1);
  const p = newProject();
  const c = p.channels[4];
  c.params.maxPoly = 1;
  assert.equal(channelNotes(c, [n(0, 60, BEAT * 2), n(BEAT, 62)])[0].len, BEAT);
  assert.equal(normalizeProject(JSON.parse(serialize(p))).channels[4].params.maxPoly, 1);
});

test('sketch line becomes notes with glides', () => {
  const pts = [];
  for (let t = 0; t < BEAT; t += 3) pts.push({ t, k: 60.2 });
  for (let t = BEAT; t < 2 * BEAT; t += 3) pts.push({ t, k: 63.9 });
  const out = sketchToNotes(pts, STEP);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((x) => [x.t, x.key, x.len, !!x.slide]), [[0, 60, BEAT, false], [BEAT, 64, BEAT, true]]);
  assert.ok(!sketchToNotes(pts, STEP, { glide: false })[1].slide);
  const sc = sketchToNotes([{ t: 0, k: 61 }], STEP, { scale: { root: 0, type: 'major' } });
  assert.ok(inScale(sc[0].key, 0, 'major'));
  assert.deepEqual(sketchToNotes([], STEP), []);
});
