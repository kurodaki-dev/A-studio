import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEP, BAR, BEAT } from '../src/constants.js';
import { chopNotes, glueNotes, flamNotes, shapeVelocity, makeRiff, inScale } from '../src/notetools.js';
import { newProject } from '../src/store.js';
import { collectEvents, trackSilent } from '../src/audio/engine.js';
import { channelNotes } from '../src/channelfx.js';
import { lastPhrase } from '../src/scorelog.js';

const n = (t, key, len = STEP, vel = 0.8) => ({ t, len, key, vel });

test('chop and glue', () => {
  const out = chopNotes([n(0, 60, BEAT)], STEP);
  assert.equal(out.length, BEAT / STEP);
  assert.deepEqual(out.map((x) => x.t), [0, STEP, 2 * STEP, 3 * STEP]);
  const glued = glueNotes(out.concat([n(BAR, 60)]));
  assert.equal(glued.length, 2);
  assert.equal(glued[0].len, BEAT);
  assert.equal(glueNotes([n(0, 60), n(0, 64)]).length, 2);
});

test('flam adds a softer note before', () => {
  const f = flamNotes([n(0, 60), n(BEAT, 62)], 6);
  assert.equal(f.length, 1);
  assert.equal(f[0].t, BEAT - 6);
  assert.ok(f[0].vel < 0.8);
});

test('velocity shapes', () => {
  const list = [n(0, 60), n(BEAT, 60), n(2 * BEAT, 60)];
  shapeVelocity(list, 'up');
  assert.ok(list[0].vel < list[1].vel && list[1].vel < list[2].vel);
  shapeVelocity(list, 'down');
  assert.ok(list[0].vel > list[2].vel);
  shapeVelocity(list, 0.5);
  assert.ok(list.every((x) => x.vel === 0.5));
});

test('riff stays in the scale and the length', () => {
  let s = 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const r = makeRiff({ length: BAR * 2, step: STEP, root: 9, scale: 'minor', center: 60, rnd });
  assert.ok(r.length > 4);
  assert.ok(r.every((x) => inScale(x.key, 9, 'minor') && x.t + x.len <= BAR * 2));
});

test('muted notes, muted clips and solo tracks do not play', () => {
  const p = newProject();
  const pat = p.patterns[0];
  const c = p.channels[0];
  pat.notes[c.id] = [n(0, 60), { ...n(STEP, 62), mute: true }];
  assert.equal(channelNotes(c, pat.notes[c.id]).length, 1);
  p.playlist.clips = [{ id: 'a', track: 0, start: 0, patternId: pat.id }, { id: 'b', track: 1, start: 0, patternId: pat.id }];
  const count = () => { let k = 0; collectEvents(p, 'song', 0, BAR, () => { k++; }); return k; };
  assert.equal(count(), 2);
  p.playlist.clips[1].mute = true;
  assert.equal(count(), 1);
  delete p.playlist.clips[1].mute;
  p.playlist.tracks[1].solo = true;
  assert.ok(trackSilent(p, 0) && !trackSilent(p, 1));
  assert.equal(count(), 1);
});

test('score log keeps the last phrase', () => {
  const ms = 60000 / (120 * 4); // one step (16th note) at 120 BPM = 125 ms
  const e = (ch, key, on, len = 200) => ({ channelId: ch, key, vel: 0.8, on, off: on + len });
  const ph = lastPhrase(120, [e('a', 50, 0), e('b', 60, 10000), e('b', 62, 10000 + ms), e('c', 64, 10000 + 2 * ms)]);
  assert.equal(ph.count, 3);
  assert.ok(!ph.byChannel.a);
  assert.equal(ph.byChannel.b[0].t, 0);
  assert.equal(ph.byChannel.b[1].t, STEP);
  assert.equal(ph.byChannel.c[0].t, 2 * STEP);
  assert.equal(lastPhrase(120, []), null);
});
