import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEP, BAR } from '../src/constants.js';
import {
  inScale, nearestInScale, snapToScale, chordify, arpeggiate, strum, humanize, legato,
  reverseNotes, flipNotes, stretchNotes, fillEach, shiftSteps, randomSteps,
} from '../src/notetools.js';
import { newProject, normalizeProject, makePattern } from '../src/store.js';
import { soloProject, collectEvents } from '../src/audio/engine.js';

const n = (t, key, len = STEP, vel = 0.8) => ({ t, len, key, vel });

test('scales', () => {
  assert.ok(inScale(60, 0, 'major'));
  assert.ok(!inScale(61, 0, 'major'));
  assert.ok(inScale(61, 0, 'none'));
  assert.ok(inScale(57, 9, 'minor')); // A in A minor
  assert.equal(nearestInScale(61, 0, 'major'), 60);
  const notes = snapToScale([n(0, 66)], 0, 'pentaMajor');
  assert.equal(notes[0].key, 67);
});

test('chords and arpeggios', () => {
  const add = chordify([n(0, 60)], 'min7');
  assert.deepEqual(add.map((x) => x.key), [63, 67, 70]);
  const chord = [n(0, 60, BAR / 4), n(0, 64, BAR / 4), n(0, 67, BAR / 4)];
  const up = arpeggiate(chord, STEP, 'up');
  assert.deepEqual(up.map((x) => x.key), [60, 64, 67, 60]);
  assert.deepEqual(up.map((x) => x.t), [0, 24, 48, 72]);
  const down = arpeggiate(chord, STEP, 'down');
  assert.equal(down[0].key, 67);
  const ud = arpeggiate([n(0, 60, 6 * STEP), n(0, 64, 6 * STEP), n(0, 67, 6 * STEP)], STEP, 'updown');
  assert.deepEqual(ud.map((x) => x.key), [60, 64, 67, 64, 60, 64]);
});

test('strum, humanize, legato', () => {
  const chord = [n(0, 67, 96), n(0, 60, 96), n(0, 64, 96)];
  strum(chord, 6);
  const byKey = Object.fromEntries(chord.map((x) => [x.key, x]));
  assert.equal(byKey[60].t, 0);
  assert.equal(byKey[64].t, 6);
  assert.equal(byKey[67].t, 12);
  assert.equal(byKey[67].len, 84);
  const h = humanize([n(10, 60)], { vel: 0.1, time: 4, rnd: () => 1 });
  assert.ok(Math.abs(h[0].vel - 0.9) < 1e-9);
  assert.equal(h[0].t, 14);
  const lg = legato([n(0, 60), n(96, 62), n(96, 65), n(200, 64)]);
  assert.equal(lg[0].len, 96);
  assert.equal(lg[1].len, 104);
  assert.equal(lg[3].len, STEP);
});

test('reverse, flip, stretch', () => {
  const r = reverseNotes([n(0, 60, 24), n(72, 62, 24)]);
  assert.equal(r[0].t, 72);
  assert.equal(r[1].t, 0);
  const f = flipNotes([n(0, 60), n(0, 67)]);
  assert.deepEqual(f.map((x) => x.key), [67, 60]);
  const s = stretchNotes([n(24, 60, 24), n(48, 60, 24)], 2);
  assert.deepEqual(s.map((x) => [x.t, x.len]), [[24, 48], [72, 48]]);
});

test('step helpers', () => {
  assert.deepEqual(fillEach(4, BAR).map((x) => x.t), [0, 96, 192, 288]);
  const sh = shiftSteps(fillEach(4, BAR), -1, BAR);
  assert.deepEqual(sh.map((x) => x.t), [360, 72, 168, 264]);
  assert.equal(randomSteps(BAR, 1, () => 0).length, 16);
  assert.equal(randomSteps(BAR, 0.5, () => 0.9).length, 0);
});

test('project keeps scale, info, eq and reverse', () => {
  const p = newProject();
  p.scale = { root: 9, type: 'minor' };
  p.author = 'Me';
  p.notes = 'Hook in bar 9';
  p.mixer[2].eq = [3, -2, 40];
  p.channels[0].params.reverse = true;
  const q = normalizeProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(q.scale, { root: 9, type: 'minor' });
  assert.equal(q.author, 'Me');
  assert.equal(q.notes, 'Hook in bar 9');
  assert.deepEqual(q.mixer[2].eq, [3, -2, 18]);
  assert.equal(q.channels[0].params.reverse, true);
  const old = normalizeProject({ channels: [], patterns: [] });
  assert.deepEqual(old.scale, { root: 0, type: 'none' });
  assert.deepEqual(old.mixer[1].eq, [0, 0, 0]);
});

test('stem projects keep one channel and the song length', () => {
  const p = newProject();
  const pat = p.patterns[0];
  pat.notes[p.channels[0].id] = [n(0, 60)];
  pat.notes[p.channels[1].id] = [n(24, 60)];
  p.playlist.clips = [{ id: 'k1', track: 0, start: 0, patternId: pat.id }, { id: 'k2', track: 1, start: BAR * 3, type: 'audio', sampleId: 's1', name: 'x', len: BAR }];
  const solo = soloProject(p, p.channels[1].id);
  assert.ok(solo.channels[0].mute && !solo.channels[1].mute);
  let audio = 0;
  collectEvents(solo, 'song', 0, BAR * 4, () => {}, () => { audio += 1; });
  assert.equal(audio, 0);
  const onlyAudio = soloProject(p, 'audio');
  audio = 0;
  collectEvents(onlyAudio, 'song', 0, BAR * 4, () => {}, () => { audio += 1; });
  assert.equal(audio, 1);
  assert.equal(p.channels[0].mute, false);
  assert.ok(makePattern(2));
});
