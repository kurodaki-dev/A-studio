import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureLoudness } from '../src/loudness.js';
import { detectBpm, timeStretch, EDITS } from '../src/audiotools.js';
import { latencyFromRecording } from '../src/recorder.js';
import { cleanSynth, osc3Instrument, SYNTH_PRESETS } from '../src/audio/osc3.js';
import { newProject, normalizeProject, autoTargetValid } from '../src/store.js';
import { autoTargets, targetValue, fxTarget } from '../src/automation.js';
import { Engine } from '../src/audio/engine.js';
import { usedSampleIds } from '../src/projectzip.js';
import { BAR, STEP } from '../src/constants.js';

const SR = 48000;
const sine = (f, sec, amp = 1) => Float32Array.from({ length: Math.floor(SR * sec) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR));

test('loudness in LUFS follows BS.1770', () => {
  // A full scale 997 Hz sine on one channel reads about -3 LUFS.
  const one = measureLoudness([sine(997, 3), new Float32Array(SR * 3)], SR);
  assert.ok(Math.abs(one.lufs + 3.01) < 0.15, 'got ' + one.lufs);
  assert.ok(Math.abs(one.peakDb) < 0.01);
  // Half the amplitude is 6 dB quieter.
  const half = measureLoudness([sine(997, 3, 0.5), new Float32Array(SR * 3)], SR);
  assert.ok(Math.abs(half.lufs - one.lufs + 6.02) < 0.1, 'got ' + half.lufs);
  assert.equal(measureLoudness([new Float32Array(SR)], SR).lufs, -Infinity);
});

test('BPM detection on a click loop', () => {
  for (const bpm of [90, 128, 140]) {
    const d = new Float32Array(SR * 8);
    const period = (60 / bpm) * SR;
    for (let b = 0; b * period < d.length - 2000; b++) {
      const s = Math.round(b * period);
      for (let i = 0; i < 1500; i++) d[s + i] = Math.sin(i * 0.3) * Math.exp(-i / 300);
    }
    const found = detectBpm(d, SR);
    assert.ok(Math.abs(found - bpm) <= 1.5, bpm + ' found ' + found);
  }
});

test('time stretch changes the length and keeps the pitch', () => {
  const src = sine(220, 2, 0.5);
  const [out] = timeStretch([src], SR, 1.5);
  assert.equal(out.length, Math.round(src.length * 1.5));
  // Count zero crossings in the middle: the frequency stays at 220 Hz.
  const a = out.subarray(SR, SR * 2);
  let n = 0;
  for (let i = 1; i < a.length; i++) if (a[i - 1] < 0 && a[i] >= 0) n += 1;
  assert.ok(Math.abs(n - 220) <= 4, 'got ' + n);
});

test('waveform edits', () => {
  const chs = [Float32Array.from([1, 1, 1, 1, 1, 1, 1, 1])];
  assert.deepEqual([...EDITS.silence(chs, 2, 4)[0]], [1, 1, 0, 0, 1, 1, 1, 1]);
  assert.equal(EDITS.cut(chs, 2, 5)[0].length, 5);
  assert.equal(EDITS.trim(chs, 2, 5)[0].length, 3);
  assert.deepEqual([...EDITS.fadeIn(chs, 0, 4)[0]].slice(0, 4), [0, 0.25, 0.5, 0.75]);
  assert.ok(Math.abs(EDITS.gain(chs, 0, 8, -6)[0][0] - 0.501) < 0.01);
  const rev = EDITS.reverse([Float32Array.from([1, 2, 3, 4])], 0, 4)[0];
  assert.deepEqual([...rev], [4, 3, 2, 1]);
  assert.ok(Math.abs(EDITS.normalize([Float32Array.from([0.1, -0.2])], 0, 2)[0][1] + 0.97) < 1e-6);
  assert.equal(chs[0][2], 1, 'edits work on copies');
});

test('recording latency is measured from the click onsets', () => {
  const sr = 44100;
  const clicks = [0.7, 1.2, 1.7, 2.2];
  const d = new Float32Array(sr * 3);
  for (const c of clicks) {
    const s = Math.round((c + 0.083) * sr);
    for (let i = 0; i < 200; i++) d[s + i] = 0.6 * Math.sin(i);
  }
  const ms = latencyFromRecording(d, sr, clicks);
  assert.ok(Math.abs(ms - 83) <= 2, 'got ' + ms);
  assert.throws(() => latencyFromRecording(new Float32Array(sr), sr, clicks), /No click/);
});

test('3x Osc settings and presets', () => {
  const s = cleanSynth({ osc: [{ wave: 9, coarse: 99, fine: -500, level: 2 }], noise: -1 });
  assert.deepEqual(s.osc[0], { wave: 3, coarse: 36, fine: -100, level: 1 });
  assert.equal(s.osc.length, 3);
  assert.equal(s.noise, 0);
  for (const p of SYNTH_PRESETS) assert.equal(cleanSynth(p.synth).osc.length, 3, p.name);
  assert.equal(typeof osc3Instrument({}).play, 'function');
  const proj = newProject();
  proj.channels[0].instrument = 'osc3';
  proj.channels[0].synth = { osc: [{ wave: 0, coarse: -12, fine: 0, level: 0.5 }], noise: 0.2 };
  const q = normalizeProject(JSON.parse(JSON.stringify(proj)));
  assert.equal(q.channels[0].synth.osc[0].coarse, -12);
  assert.equal(q.channels[0].synth.noise, 0.2);
  assert.equal(q.channels[1].synth, undefined);
});

test('effect parameters can be automated', () => {
  const p = newProject();
  p.mixer[3].fx = [{ plugin: 'astudio-filter', on: true, params: { cutoff: 0.25 } }];
  const ids = autoTargets(p).map((x) => x.id);
  assert.ok(ids.includes('fx:3:0:cutoff'));
  assert.ok(!ids.includes('fx:3:0:type'), 'choices are not automated');
  assert.ok(autoTargetValid(p, 'fx:3:0:cutoff'));
  assert.ok(!autoTargetValid(p, 'fx:3:1:cutoff'));
  assert.ok(Math.abs(targetValue(p, 'fx:3:0:cutoff') - 0.25) < 1e-9);
  assert.equal(fxTarget(p, 'fx:3:0:cutoff').def.id, 'cutoff');
  p.playlist.clips = [{ id: 'a', type: 'auto', target: 'fx:3:0:cutoff', track: 2, start: 0, len: BAR, points: [[0, 0], [BAR, 1]] }];
  const q = normalizeProject(JSON.parse(JSON.stringify(p)));
  assert.equal(q.playlist.clips.length, 1);
});

test('performance mode plays pads from the next bar, each pattern looping', () => {
  const p = newProject();
  const pat = p.patterns[0];
  const kick = p.channels[0];
  pat.notes[kick.id] = [{ t: 0, len: STEP, key: 60, vel: 1 }];
  const store = { project: p };
  const e = new Engine(store, () => 'live', () => false);
  e.live.set(pat.id, { from: BAR * 2, until: BAR * 4 });
  const hits = [];
  e.liveEvents(p, 0, BAR * 6, (c, n, tt) => hits.push(tt));
  assert.deepEqual(hits, [BAR * 2, BAR * 3]);
  e.live.clear();
  assert.equal(e.togglePad(pat.id), 0);
  assert.equal(e.live.get(pat.id).until, Infinity);
  e.togglePad(pat.id);
  assert.equal(e.live.get(pat.id).until, 0);
});

test('project ZIP lists every sample the project uses', () => {
  const p = newProject();
  p.channels[0].instrument = 'sampler';
  p.channels[0].sample = 's1';
  p.channels[1].instrument = 'sampler';
  p.channels[1].zones = [{ key: 60, sample: 's2' }, { key: 72, sample: 's1' }];
  p.playlist.clips = [{ id: 'k', type: 'audio', sampleId: 's3', track: 0, start: 0, len: BAR }];
  assert.deepEqual(usedSampleIds(p).sort(), ['s1', 's2', 's3']);
});

test('compressor makeup gain of the Web Audio spec is cancelled', async () => {
  const { autoMakeupDb } = await import('../src/audio/builtinfx.js');
  assert.ok(Math.abs(autoMakeupDb(-20, 4) - 9) < 1e-9);
  assert.ok(Math.abs(autoMakeupDb(0, 4)) < 1e-12);
});
