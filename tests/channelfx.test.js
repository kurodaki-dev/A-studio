import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arpExpand, monoPorta, channelNotes } from '../src/channelfx.js';
import { newProject, normalizeProject } from '../src/store.js';
import { collectEvents, slideFrom } from '../src/audio/engine.js';
import { STEP, BAR } from '../src/constants.js';

const chord = [60, 64, 67].map((key) => ({ t: 0, len: STEP * 8, key, vel: 0.8 }));

test('arpeggiator directions, range and gate', () => {
  const up = arpExpand(chord, { dir: 0, range: 1, step: 1, gate: 0.5 });
  assert.deepEqual(up.map((n) => n.key), [60, 64, 67, 60, 64, 67, 60, 64]);
  assert.deepEqual(up.slice(0, 3).map((n) => [n.t, n.len]), [[0, 12], [24, 12], [48, 12]]);
  assert.deepEqual(arpExpand(chord, { dir: 1, range: 1, step: 1 }).map((n) => n.key).slice(0, 3), [67, 64, 60]);
  assert.deepEqual(arpExpand(chord, { dir: 2, range: 1, step: 1 }).map((n) => n.key).slice(0, 5), [60, 64, 67, 64, 60]);
  assert.deepEqual(arpExpand(chord, { dir: 0, range: 2, step: 1 }).map((n) => n.key).slice(0, 6), [60, 64, 67, 72, 76, 79]);
  const rnd = arpExpand(chord, { dir: 3, range: 1, step: 1 });
  assert.deepEqual(rnd, arpExpand(chord, { dir: 3, range: 1, step: 1 }), 'random order is repeatable');
  assert.equal(arpExpand(chord, { dir: 0, range: 1, step: 2 }).length, 4);
});

test('mono and portamento', () => {
  const notes = [{ t: 0, len: 96, key: 60, vel: 1 }, { t: 0, len: 96, key: 64, vel: 1 }, { t: 48, len: 48, key: 62, vel: 1 }];
  const m = monoPorta(notes, true, false);
  assert.deepEqual(m.map((n) => [n.t, n.len, n.key]), [[0, 48, 64], [48, 48, 62]]);
  const p = monoPorta(notes, true, true);
  assert.equal(p[1].slideFromKey, 64);
  assert.equal(slideFrom(p, p[1]), 64);
  assert.equal(notes[0].len, 96, 'the pattern notes are not changed');
});

test('channel settings reach playback and survive normalize', () => {
  const proj = newProject();
  const piano = proj.channels.find((c) => c.instrument === 'piano');
  proj.patterns[0].notes[piano.id] = chord.map((n) => ({ ...n }));
  piano.arp = { on: true, dir: 0, range: 1, step: 1, gate: 0.5 };
  piano.lfo = { on: true, target: 2, shape: 1, rate: 3, sync: 2, amount: 0.7 };
  piano.params.fenvAmt = 0.5;
  piano.params.penvAmt = -12;
  piano.params.mono = true;
  const q = normalizeProject(JSON.parse(JSON.stringify(proj)));
  const c = q.channels.find((x) => x.id === piano.id);
  assert.deepEqual(c.arp, { on: true, dir: 0, range: 1, step: 1, gate: 0.5 });
  assert.equal(c.lfo.target, 2);
  assert.equal(c.lfo.sync, 2);
  assert.equal(c.params.fenvAmt, 0.5);
  assert.equal(c.params.penvAmt, -12);
  const keys = [];
  collectEvents(q, 'pattern', 0, BAR, (ch, n) => { if (ch.id === c.id) keys.push(n.key); });
  assert.deepEqual(keys, [60, 64, 67, 60, 64, 67, 60, 64]);
  // Cached until the notes change.
  const notes = q.patterns[0].notes[c.id];
  assert.equal(channelNotes(c, notes), channelNotes(c, notes));
  notes[0].key = 59;
  assert.equal(channelNotes(c, notes)[0].key, 59);
});

test('sampler fades survive normalize', () => {
  const proj = newProject();
  proj.channels[0].instrument = 'sampler';
  proj.channels[0].sample = 's1';
  proj.channels[0].params.fadeIn = 0.2;
  proj.channels[0].params.fadeOut = 0.9;
  const q = normalizeProject(JSON.parse(JSON.stringify(proj)));
  assert.equal(q.channels[0].params.fadeIn, 0.2);
  assert.equal(q.channels[0].params.fadeOut, 0.5, 'fades are limited to half of the part');
});
