import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAR, STEP, noteName, isBlack, snapTicks } from '../src/constants.js';
import {
  newProject,
  makePattern,
  patternLength,
  songLength,
  isStepChannel,
  normalizeProject,
  serialize,
  store,
  nextPatternIndex,
} from '../src/store.js';
import { collectEvents, loopLength, faderGain } from '../src/audio/engine.js';
import { encodeWav } from '../src/wav.js';
import { INSTRUMENTS } from '../src/audio/instruments.js';
import { INSTRUMENT_IDS } from '../src/audio/catalog.js';

test('note names follow FL Studio (MIDI 60 is C5)', () => {
  assert.equal(noteName(60), 'C5');
  assert.equal(noteName(61), 'C#5');
  assert.equal(noteName(0), 'C0');
  assert.equal(noteName(131), 'B10');
  assert.equal(isBlack(61), true);
  assert.equal(isBlack(64), false);
});

test('snap values in ticks (96 PPQ)', () => {
  assert.equal(snapTicks('step'), 24);
  assert.equal(snapTicks('beat'), 96);
  assert.equal(snapTicks('bar'), 384);
  assert.equal(snapTicks('unknown'), 24);
});

test('pattern length rounds up to whole bars, minimum one bar', () => {
  const p = makePattern(1);
  assert.equal(patternLength(p), BAR);
  p.notes.a = [{ t: BAR + 10, len: 24, key: 60, vel: 0.8 }];
  assert.equal(patternLength(p), 2 * BAR);
  p.minBars = 4;
  assert.equal(patternLength(p), 4 * BAR);
});

test('song length follows the last clip', () => {
  const proj = newProject();
  assert.equal(songLength(proj), BAR);
  proj.playlist.clips.push({ id: 'k1', patternId: proj.patterns[0].id, track: 0, start: 3 * BAR });
  assert.equal(songLength(proj), 4 * BAR);
});

test('step mode detection', () => {
  assert.equal(isStepChannel([]), true);
  assert.equal(isStepChannel([{ t: 0, len: STEP, key: 60, vel: 1 }]), true);
  assert.equal(isStepChannel([{ t: 0, len: STEP, key: 62, vel: 1 }]), false);
  assert.equal(isStepChannel([{ t: 0, len: 48, key: 60, vel: 1 }]), false);
});

test('every instrument in the catalog has a synth', () => {
  for (const id of INSTRUMENT_IDS) assert.equal(typeof INSTRUMENTS[id].play, 'function', id);
});

test('normalizeProject rejects garbage and repairs values', () => {
  assert.throws(() => normalizeProject(null));
  assert.throws(() => normalizeProject({ channels: 'x' }));
  const raw = JSON.parse(serialize(newProject()));
  raw.bpm = 9999;
  raw.channels[0].instrument = 'nope';
  raw.channels[0].vol = -5;
  const cid = raw.channels[0].id;
  raw.patterns[0].notes[cid] = [{ t: -10, len: 0, key: 500, vel: 2 }, { bad: true }];
  raw.patterns[0].notes.ghost = [{ t: 0, len: 24, key: 60, vel: 1 }];
  raw.playlist.clips = [{ patternId: 'missing', track: 0, start: 0 }];
  const p = normalizeProject(raw);
  assert.equal(p.bpm, 522);
  assert.equal(p.channels[0].instrument, 'piano');
  assert.equal(p.channels[0].vol, 0);
  assert.deepEqual(p.patterns[0].notes[cid], [{ t: 0, len: 1, key: 131, vel: 1 }]);
  assert.equal(p.patterns[0].notes.ghost, undefined);
  assert.equal(p.playlist.clips.length, 0);
});

test('selection flags are not saved', () => {
  const p = newProject();
  p.patterns[0].notes[p.channels[0].id] = [{ t: 0, len: 24, key: 60, vel: 1, s: true }];
  assert.equal(serialize(p).includes('"s"'), false);
});

test('undo and redo', () => {
  store.load(newProject());
  store.change((p) => { p.bpm = 140; });
  store.change((p) => { p.bpm = 150; });
  assert.equal(store.project.bpm, 150);
  store.undo();
  assert.equal(store.project.bpm, 140);
  store.undo();
  assert.equal(store.project.bpm, 130);
  assert.equal(store.undo(), false);
  store.redo();
  assert.equal(store.project.bpm, 140);
  store.commit();
  store.project.bpm = 99;
  store.revert();
  assert.equal(store.project.bpm, 140);
});

test('pattern names count up', () => {
  const p = newProject();
  assert.equal(nextPatternIndex(p), 2);
  p.patterns.push(makePattern(7));
  assert.equal(nextPatternIndex(p), 8);
});

test('collectEvents in pattern mode returns notes in the window', () => {
  const p = newProject();
  const c = p.channels[0];
  p.patterns[0].notes[c.id] = [
    { t: 0, len: 24, key: 60, vel: 1 },
    { t: 96, len: 24, key: 60, vel: 1 },
    { t: 383, len: 1, key: 60, vel: 1 },
  ];
  const got = [];
  collectEvents(p, 'pattern', 0, 96, (ch, n, t) => got.push(t));
  assert.deepEqual(got, [0]);
  got.length = 0;
  collectEvents(p, 'pattern', 96, 384, (ch, n, t) => got.push(t));
  assert.deepEqual(got, [96, 383]);
});

test('collectEvents in song mode offsets clips and skips muted tracks', () => {
  const p = newProject();
  const c = p.channels[0];
  const pat = p.patterns[0];
  pat.notes[c.id] = [{ t: 0, len: 24, key: 60, vel: 1 }];
  p.playlist.clips.push({ id: 'a', patternId: pat.id, track: 0, start: 0 });
  p.playlist.clips.push({ id: 'b', patternId: pat.id, track: 1, start: 2 * BAR });
  p.playlist.clips.push({ id: 'c', patternId: pat.id, track: 2, start: 4 * BAR });
  p.playlist.tracks[2].mute = true;
  const got = [];
  collectEvents(p, 'song', 0, 10 * BAR, (ch, n, t) => got.push(t));
  assert.deepEqual(got.sort((a, b) => a - b), [0, 2 * BAR]);
  assert.equal(loopLength(p, 'song'), 5 * BAR);
});

test('fader at 80 percent is unity gain', () => {
  assert.equal(faderGain(0.8), 1);
  assert.equal(faderGain(0), 0);
});

test('WAV header and samples', () => {
  const l = new Float32Array([0, 1, -1, 2]);
  const r = new Float32Array([0, 0.5, -0.5, -2]);
  const buf = encodeWav([l, r], 44100);
  const v = new DataView(buf);
  const txt = (o) => String.fromCharCode(...new Uint8Array(buf, o, 4));
  assert.equal(txt(0), 'RIFF');
  assert.equal(txt(8), 'WAVE');
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 44100);
  assert.equal(v.getUint32(40, true), 16);
  assert.equal(buf.byteLength, 44 + 16);
  assert.equal(v.getInt16(44 + 4, true), 32767);
  assert.equal(v.getInt16(44 + 8, true), -32768);
  assert.equal(v.getInt16(44 + 14, true), -32768);
});
