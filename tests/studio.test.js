import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEP, PPQ, BAR } from '../src/constants.js';
import { newProject, normalizeProject, store, clipValid, clipLength, songLength } from '../src/store.js';
import { collectEvents, slideFrom } from '../src/audio/engine.js';
import { tempoChanges, bpmAt, tickToSec, nextTempoChange } from '../src/tempo.js';
import { autoValue, autoTargets, targetValue } from '../src/automation.js';
import { encodeMidi } from '../src/midi.js';
import { decodeMidi, importMidi } from '../src/midiimport.js';
import { noteFromName, zonesFromSamples } from '../src/zones.js';
import { equalSlices, sliceNotes } from '../src/slicer.js';
import { encodeWav } from '../src/wav.js';
import { TEMPLATES } from '../src/templates.js';
import * as constants from '../src/constants.js';

test('time signature changes the bar length everywhere', () => {
  const p = newProject();
  p.beats = 3;
  store.load(p);
  assert.equal(constants.BAR, 288);
  store.load(newProject());
  assert.equal(constants.BAR, 384);
  const q = normalizeProject({ channels: [], patterns: [], beats: 9 });
  assert.equal(q.beats, 4);
});

test('tempo markers', () => {
  const p = newProject();
  p.bpm = 120;
  p.markers = [{ id: 'a', t: BAR * 2, name: 'Drop', bpm: 60 }, { id: 'b', t: BAR, name: 'Verse' }];
  assert.equal(tempoChanges(p).length, 2);
  assert.equal(bpmAt(p, BAR), 120);
  assert.equal(bpmAt(p, BAR * 2), 60);
  assert.equal(bpmAt(p, BAR * 3, 'pattern'), 120);
  assert.equal(nextTempoChange(p, 0), BAR * 2);
  // 2 bars at 120 = 4 s, then 1 bar at 60 = 4 s
  assert.ok(Math.abs(tickToSec(p, BAR * 3) - 8) < 1e-9);
  const q = normalizeProject(JSON.parse(JSON.stringify(p)));
  assert.equal(q.markers[0].name, 'Verse');
  assert.equal(q.markers[1].bpm, 60);
});

test('automation clips', () => {
  assert.equal(autoValue([[0, 0], [100, 1]], 50), 0.5);
  assert.equal(autoValue([[10, 0.2]], 0), 0.2);
  assert.equal(autoValue([[0, 0], [100, 1]], 400), 1);
  const p = newProject();
  const targets = autoTargets(p);
  assert.ok(targets.some((x) => x.id === 'mixer:0:vol'));
  assert.ok(!targets.some((x) => x.id === 'mixer:0:reverb'));
  assert.equal(targetValue(p, 'mixer:1:pan'), 0.5);
  const target = 'channel:' + p.channels[0].id + ':cutoff';
  p.playlist.clips = [
    { id: 'k1', type: 'auto', target, track: 3, start: 0, len: BAR * 8, points: [[0, 0], [BAR * 8, 1]] },
    { id: 'k2', type: 'auto', target: 'channel:gone:vol', track: 4, start: 0, len: BAR, points: [[0, 0]] },
  ];
  const q = normalizeProject(JSON.parse(JSON.stringify(p)));
  assert.equal(q.playlist.clips.length, 1);
  assert.ok(clipValid(q, q.playlist.clips[0]));
  assert.equal(clipLength(q, q.playlist.clips[0]), BAR * 8);
  assert.equal(songLength(q), BAR * 8);
  let notes = 0;
  collectEvents(q, 'song', 0, BAR * 8, () => { notes += 1; });
  assert.equal(notes, 0);
});

test('clip offset, mixer routing, slides and sampler fields survive normalize', () => {
  const p = newProject();
  const pat = p.patterns[0];
  const cid = p.channels[0].id;
  pat.notes[cid] = [{ t: 0, len: STEP, key: 60, vel: 0.8 }, { t: STEP * 8, len: STEP, key: 64, vel: 0.8, slide: true }];
  p.playlist.clips = [{ id: 'k', track: 0, start: BAR, patternId: pat.id, offset: STEP * 8, len: STEP * 8 }];
  p.mixer[2].route = 5;
  p.mixer[6].route = 3; // lower insert: not allowed, back to master
  p.channels[0].params.loop = true;
  p.channels[0].slices = [0, 0.5];
  p.channels[0].color = 2;
  p.channels[0].group = 'Drums';
  p.mixer[1].fx = [{ plugin: 'astudio-sidechain', on: true, params: { depth: 0.5 }, source: cid }];
  const q = normalizeProject(JSON.parse(JSON.stringify(p)));
  assert.equal(q.playlist.clips[0].offset, STEP * 8);
  assert.equal(q.mixer[2].route, 5);
  assert.equal(q.mixer[6].route, 0);
  assert.equal(q.channels[0].params.loop, true);
  assert.deepEqual(q.channels[0].slices, [0, 0.5]);
  assert.equal(q.channels[0].group, 'Drums');
  assert.equal(q.mixer[1].fx[0].source, cid);
  assert.equal(q.patterns[0].notes[cid][1].slide, true);
  assert.equal(q.patterns[0].notes[cid][0].slide, undefined);
  // The clip starts half way in the pattern: only the second note plays, at the clip start.
  const hits = [];
  collectEvents(q, 'song', 0, BAR * 4, (c, n, tt) => hits.push([n.key, tt]));
  assert.deepEqual(hits, [[64, BAR]]);
  const arr = q.patterns[0].notes[cid];
  assert.equal(slideFrom(arr, arr[1]), 60);
  assert.equal(slideFrom(arr, arr[0]), null);
});

test('MIDI files round trip into a new pattern', () => {
  const p = newProject();
  p.bpm = 100;
  const pat = p.patterns[0];
  const piano = p.channels.find((c) => c.instrument === 'piano');
  const kick = p.channels.find((c) => c.instrument === 'kick');
  pat.notes[piano.id] = [{ t: 0, len: 96, key: 60, vel: 0.8 }, { t: 96, len: 48, key: 67, vel: 0.5 }];
  pat.notes[kick.id] = [{ t: 0, len: STEP, key: 60, vel: 0.9 }, { t: 192, len: STEP, key: 60, vel: 0.9 }];
  const bytes = encodeMidi(p, 'pattern');
  const parsed = decodeMidi(bytes);
  assert.equal(parsed.ppq, PPQ);
  assert.equal(Math.round(parsed.bpm), 100);
  const target = newProject();
  target.channels = [];
  const res = importMidi(target, parsed, 'song');
  assert.equal(res.pattern.name, 'song');
  assert.equal(target.bpm, 100);
  const pianoCh = target.channels.find((c) => c.instrument === 'piano');
  const kickCh = target.channels.find((c) => c.instrument === 'kick');
  assert.ok(pianoCh && kickCh);
  assert.deepEqual(res.pattern.notes[pianoCh.id].map((n) => [n.t, n.len, n.key]), [[0, 96, 60], [96, 48, 67]]);
  assert.deepEqual(res.pattern.notes[kickCh.id].map((n) => n.t), [0, 192]);
  assert.throws(() => decodeMidi(new Uint8Array([1, 2, 3])), /MIDI/);
});

test('multi sample zones and slicer', () => {
  assert.equal(noteFromName('Piano C4.wav'), 60);
  assert.equal(noteFromName('rhodes_F#3.wav'), 54);
  assert.equal(noteFromName('Bass Eb2.ogg'), 39);
  assert.equal(noteFromName('pad-72.wav'), 72);
  assert.equal(noteFromName('kick.wav'), null);
  const z = zonesFromSamples([{ id: 'b', name: 'X C5.wav' }, { id: 'a', name: 'X C4.wav' }, { id: 'c', name: 'loop.wav' }]);
  assert.deepEqual(z, [{ key: 60, sample: 'a' }, { key: 72, sample: 'b' }]);
  assert.deepEqual(equalSlices(4), [0, 0.25, 0.5, 0.75]);
  // 2 s loop at 120 BPM = one 4/4 bar: slices land on beats.
  const n = sliceNotes(equalSlices(4), 2, 120);
  assert.deepEqual(n.map((x) => [x.t, x.key]), [[0, 60], [96, 61], [192, 62], [288, 63]]);
});

test('24 bit WAV and templates', () => {
  const w = encodeWav([new Float32Array([0, 1]), new Float32Array([0, -1])], 44100, 24);
  const v = new DataView(w);
  assert.equal(v.getUint16(34, true), 24);
  assert.equal(w.byteLength, 44 + 2 * 2 * 3);
  for (const tp of TEMPLATES) {
    const p = normalizeProject(JSON.parse(JSON.stringify(tp.make())));
    assert.ok(p.channels.length >= 1, tp.id);
  }
  const trap = TEMPLATES.find((x) => x.id === 'trap').make();
  const bass = trap.channels.find((c) => c.instrument === 'sub808');
  assert.ok(trap.patterns[0].notes[bass.id].some((n) => n.slide));
});
