import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, normalizeProject, serialize } from '../src/store.js';
import { STEP } from '../src/constants.js';

test('main pitch, fine tune and mute/solo/color survive a save', () => {
  const p = newProject();
  p.masterPitch = -250;
  p.channels[0].params.fine = 33;
  const c = p.channels[0];
  p.patterns[0].notes[c.id] = [{ t: 0, key: 60, len: STEP, vel: 0.8, mute: true }];
  p.playlist.tracks[2].solo = true;
  p.playlist.tracks[2].color = 3;
  p.playlist.clips = [{ id: 'k', track: 2, start: 0, patternId: p.patterns[0].id, mute: true }];
  const q = normalizeProject(JSON.parse(serialize(p)));
  assert.equal(q.masterPitch, -250);
  assert.equal(q.channels[0].params.fine, 33);
  assert.equal(q.patterns[0].notes[c.id][0].mute, true);
  assert.equal(q.playlist.tracks[2].solo, true);
  assert.equal(q.playlist.tracks[2].color, 3);
  assert.equal(q.playlist.clips[0].mute, true);
  assert.equal(normalizeProject({ ...JSON.parse(serialize(p)), masterPitch: 99999 }).masterPitch, 1200);
});
