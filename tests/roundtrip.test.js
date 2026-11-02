import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, normalizeProject, serialize } from '../src/store.js';
import { TEMPLATES } from '../src/templates.js';
import { BAR, STEP } from '../src/constants.js';

// A project that uses every feature: nothing may be lost when it is saved and opened again.
function fullProject() {
  const p = TEMPLATES.find((x) => x.id === 'trap').make();
  p.author = 'Me';
  p.notes = 'lyrics';
  p.scale = { root: 9, type: 'minor' };
  p.beats = 3;
  p.markers = [{ id: 'm1', t: BAR, name: 'Verse', bpm: 120 }];
  p.loop = { on: true, start: 0, end: BAR * 2 };
  const [k, , , bass] = p.channels;
  k.color = 2;
  k.group = 'Drums';
  bass.arp = { on: true, dir: 2, range: 2, step: 0, gate: 0.6 };
  bass.lfo = { on: true, target: 1, shape: 2, rate: 4, sync: 3, amount: 0.4 };
  Object.assign(bass.params, { fenvAmt: 0.5, fenvA: 0.01, fenvD: 0.2, fenvS: 0.3, penvAmt: -7, penvDecay: 0.2, mono: true, porta: true, decay: 0.3, sustain: 0.6, glide: 0.2 });
  p.channels.push({ id: 'samp', name: 'Chop', instrument: 'sampler', sample: 's1', vol: 0.7, pan: 0.2, mute: false, insert: 9, slices: [0, 0.5], params: { pitch: 2, attack: 0, decay: 0, sustain: 1, release: 0.1, cutoff: 1, reso: 0, glide: 0.1, start: 0.1, end: 0.9, loop: true, reverse: true, fadeIn: 0.1, fadeOut: 0.2 } });
  p.channels.push({ id: 'zz', name: 'Keys', instrument: 'sampler', sample: 'z1', vol: 0.7, pan: 0, mute: false, insert: 10, zones: [{ key: 60, sample: 'z1' }, { key: 72, sample: 'z2' }], params: {} });
  p.channels.push({ id: 'o3', name: 'Lead', instrument: 'osc3', vol: 0.7, pan: 0, mute: false, insert: 11, synth: { osc: [{ wave: 1, coarse: 12, fine: 5, level: 0.5 }], noise: 0.1 }, params: {} });
  p.patterns[0].notes[bass.id][0].slide = true;
  p.mixer[2].route = 9;
  p.mixer[3].eq = [3, -2, 1];
  p.mixer[3].fx = [{ plugin: 'astudio-autotune', on: true, params: { key: 9, mode: 1, flex: 0.3 }, source: bass.id }, { plugin: 'astudio-sidechain', on: false, params: { depth: 0.5 }, source: k.id }];
  p.playlist.tracks[4].insert = 3;
  p.playlist.tracks[4].name = 'Vox';
  p.playlist.tracks[5].mute = true;
  p.playlist.clips = [
    { id: 'c1', patternId: p.patterns[0].id, track: 0, start: 0, len: BAR * 2, offset: STEP * 4 },
    { id: 'c2', type: 'audio', sampleId: 's9', name: 'Take 1', track: 4, start: BAR, len: BAR * 3, offset: 10, gain: 1.3, pitch: -2, fadeIn: STEP, fadeOut: STEP * 2, reverse: true },
    { id: 'c3', type: 'auto', target: 'mixer:3:vol', track: 6, start: 0, len: BAR * 4, points: [[0, 0.2], [BAR * 4, 0.9]] },
    { id: 'c4', type: 'auto', target: 'fx:3:0:flex', track: 7, start: 0, len: BAR, points: [[0, 0], [BAR, 1]] },
  ];
  return p;
}

test('a project using every feature survives save and open', () => {
  const p = fullProject();
  const once = normalizeProject(JSON.parse(serialize(p)));
  const twice = normalizeProject(JSON.parse(serialize(once)));
  assert.equal(serialize(twice), serialize(once), 'opening twice gives the same project');
  const c = (id) => once.channels.find((x) => x.id === id);
  const bass = once.channels[3];
  assert.equal(once.beats, 3);
  assert.equal(once.markers[0].bpm, 120);
  // The project is in 3/4 (opening it changes the bar length): compare with the 4/4 ticks it was saved with.
  assert.deepEqual(once.loop, { on: true, start: 0, end: 768 });
  assert.equal(once.channels[0].group, 'Drums');
  assert.equal(bass.arp.dir, 2);
  assert.equal(bass.lfo.sync, 3);
  assert.equal(bass.params.porta, true);
  assert.equal(bass.params.penvAmt, -7);
  assert.equal(once.patterns[0].notes[bass.id][0].slide, true);
  assert.equal(c('samp').params.fadeOut, 0.2);
  assert.deepEqual(c('samp').slices, [0, 0.5]);
  assert.equal(c('zz').zones.length, 2);
  assert.equal(c('o3').synth.osc[0].coarse, 12);
  assert.equal(once.mixer[2].route, 9);
  assert.equal(once.mixer[3].fx[0].source, bass.id);
  assert.equal(once.mixer[3].fx[1].on, false);
  assert.equal(once.playlist.tracks[4].insert, 3);
  assert.equal(once.playlist.tracks[5].mute, true);
  const audio = once.playlist.clips.find((x) => x.id === 'c2');
  assert.deepEqual([audio.gain, audio.pitch, audio.fadeIn, audio.reverse, audio.offset], [1.3, -2, 24, true, 10]);
  assert.equal(once.playlist.clips.find((x) => x.id === 'c1').offset, 96);
  assert.equal(once.playlist.clips.filter((x) => x.type === 'auto').length, 2);
});

test('a new project and every template are stable', async () => {
  const { setBeatsPerBar } = await import('../src/constants.js');
  setBeatsPerBar(4);
  for (const p of [newProject(), ...TEMPLATES.map((x) => x.make())]) {
    const once = normalizeProject(JSON.parse(serialize(p)));
    assert.equal(serialize(normalizeProject(JSON.parse(serialize(once)))), serialize(once));
  }
});
