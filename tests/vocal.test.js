import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOX_CODE } from '../src/audio/voxworklet.js';
import { VOCAL_CHAINS, chainSlots, noteOfFreq, detectPitch } from '../src/vocal.js';
import { getBuiltinEffect, BUILTIN_EFFECTS } from '../src/audio/builtinfx.js';
import { detectKey } from '../src/notetools.js';
import { newProject, normalizeProject } from '../src/store.js';
import { trackInsert } from '../src/audio/engine.js';

const SR = 48000;

// Run the worklet code with a minimal AudioWorklet global scope.
function processors() {
  const reg = {};
  class AudioWorkletProcessor {
    constructor() {
      this.port = { onmessage: null, postMessage() {} };
    }
  }
  new Function('sampleRate', 'AudioWorkletProcessor', 'registerProcessor', VOX_CODE)(SR, AudioWorkletProcessor, (name, cls) => { reg[name] = cls; });
  return reg;
}

function run(Proc, params, input, setup) {
  const p = new Proc({ processorOptions: { params } });
  if (setup) setup(p);
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 128) {
    globalThis.currentFrame = i;
    const inp = input.subarray(i, i + 128);
    const L = new Float32Array(128);
    const R = new Float32Array(128);
    p.process([[inp, inp]], [[L, R]]);
    out.set(L.subarray(0, Math.min(128, input.length - i)), i);
  }
  return out;
}

const sine = (f, sec) => Float32Array.from({ length: Math.floor(SR * sec) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / SR));
const pitchOf = (sig) => detectPitch(sig.subarray(sig.length - 4096), SR);
// Strongest frequency of the last half second (DFT scan, 1 Hz steps around the expected value).
function zcFreq(sig, lo = 100, hi = 600) {
  const a = sig.subarray(sig.length - SR / 2);
  let best = 0;
  let bestP = -1;
  for (let f = lo; f <= hi; f += 1) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * f) / SR;
    for (let i = 0; i < a.length; i += 2) {
      re += a[i] * Math.cos(w * i);
      im += a[i] * Math.sin(w * i);
    }
    const pw = re * re + im * im;
    if (pw > bestP) {
      bestP = pw;
      best = f;
    }
  }
  return best;
}

test('every processor registers', () => {
  const reg = processors();
  assert.deepEqual(Object.keys(reg).sort(), ['astudio-vox-deess', 'astudio-vox-gate', 'astudio-vox-harmony', 'astudio-vox-shift', 'astudio-vox-tune']);
});

test('auto tune pulls a sharp note to the nearest note of the scale', () => {
  const { 'astudio-vox-tune': Tune } = processors();
  // 452 Hz is about 47 cents sharp of A (440 Hz).
  const out = run(Tune, { key: 9, scale: 0, retune: 0, mix: 1 }, sine(452, 1.5));
  const f = pitchOf(out);
  assert.ok(Math.abs(f - 440) < 4, 'got ' + f);
  // In C major, 470 Hz (between A# and B) goes to B (493.9 Hz) or A (440 Hz), never A#.
  const out2 = run(Tune, { key: 0, scale: 1, retune: 0, mix: 1 }, sine(470, 1.5));
  const n = noteOfFreq(pitchOf(out2));
  assert.ok(n.name.startsWith('B') || n.name.startsWith('A') && !n.name.startsWith('A#'), n.name);
});

test('voice changer shifts by semitones', () => {
  const { 'astudio-vox-shift': Shift } = processors();
  const out = run(Shift, { semitones: 12, tone: 0, mix: 1 }, sine(220, 1.5));
  assert.ok(Math.abs(zcFreq(out) - 440) < 5, 'got ' + zcFreq(out));
  const down = run(Shift, { semitones: -12, tone: 0, mix: 1 }, sine(440, 1.5));
  assert.ok(Math.abs(zcFreq(down) - 220) < 4, 'got ' + zcFreq(down));
  const fifth = run(Shift, { semitones: 7, tone: 0, mix: 1 }, sine(200, 1.5));
  assert.ok(Math.abs(zcFreq(fifth) - 299.7) < 4, 'got ' + zcFreq(fifth));
});

test('noise gate closes on quiet input and opens on loud input', () => {
  const { 'astudio-vox-gate': Gate } = processors();
  const quiet = Float32Array.from({ length: SR / 2 }, (_, i) => 0.001 * Math.sin(i / 7));
  const out = run(Gate, { threshold: -40, release: 50 }, quiet);
  assert.ok(Math.max(...out.subarray(out.length - 1000).map(Math.abs)) < 1e-4);
  const loud = run(Gate, { threshold: -40, release: 50 }, sine(300, 0.5));
  assert.ok(Math.max(...loud.subarray(loud.length - 1000).map(Math.abs)) > 0.4);
});

test('de-esser lowers a loud high tone more than a low tone', () => {
  const { 'astudio-vox-deess': Deess } = processors();
  const p = { freq: 5000, threshold: -30, amount: 0.9 };
  const peak = (a) => Math.max(...a.subarray(a.length - 2000).map(Math.abs));
  const hi = run(Deess, p, sine(8000, 0.5));
  const lo = run(Deess, p, sine(200, 0.5));
  assert.ok(peak(hi) < 0.3, 'high ' + peak(hi));
  assert.ok(peak(lo) > 0.45, 'low ' + peak(lo));
});

test('vocal chains only use built in effects and fit the 4 slots', () => {
  for (const c of VOCAL_CHAINS) {
    assert.ok(c.fx.length <= 4, c.id);
    for (const f of c.fx) assert.ok(getBuiltinEffect(f.plugin), f.plugin);
    const slots = chainSlots(c);
    slots[0].params.x = 1;
    assert.equal(c.fx[0].params.x, undefined);
  }
  assert.ok(BUILTIN_EFFECTS.filter((x) => x.vocal).length >= 9);
});

test('tuner pitch and note names', () => {
  assert.equal(noteOfFreq(440).name, 'A5');
  assert.equal(noteOfFreq(261.63).name, 'C5');
  assert.equal(noteOfFreq(0), null);
  const f = detectPitch(sine(196, 0.1), SR);
  assert.ok(Math.abs(f - 196) < 1, 'got ' + f);
});

test('key detection and track inserts', () => {
  // A minor chord progression: A C E, D F A, E G# B
  const notes = [57, 60, 64, 62, 65, 69, 64, 68, 71, 57, 60, 64].map((key, i) => ({ t: i * 24, len: 96, key, vel: 0.8 }));
  const k = detectKey(notes);
  assert.equal(k.root, 9);
  assert.equal(k.type, 'minor');
  assert.equal(detectKey([]), null);
  const p = newProject();
  p.playlist.tracks[2].insert = 7;
  const q = normalizeProject(JSON.parse(JSON.stringify(p)));
  assert.equal(q.playlist.tracks[2].insert, 7);
  assert.equal(q.playlist.tracks[1].insert, undefined);
  assert.equal(trackInsert(q, { track: 2 }), 7);
  assert.equal(trackInsert(q, { track: 0 }), 0);
});

test('keep formants: PSOLA shifts the pitch and keeps the resonance in place', () => {
  const { 'astudio-vox-shift': Shift } = processors();
  // Voice like signal: pulses at 150 Hz through a resonance at 1500 Hz.
  const f0 = 150;
  const n = SR * 1.5;
  const src = new Float32Array(n);
  for (let i = 0; i < n; i += SR / f0) src[Math.round(i)] = 1;
  const r = 0.995;
  const w = (2 * Math.PI * 1500) / SR;
  const voice = new Float32Array(n);
  for (let i = 2; i < n; i++) voice[i] = src[i] + 2 * r * Math.cos(w) * voice[i - 1] - r * r * voice[i - 2];
  let peak = 0;
  for (const v of voice) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) voice[i] *= 0.5 / peak;
  const centroid = (sig) => {
    const a = sig.subarray(sig.length - SR / 2);
    let num = 0;
    let den = 0;
    // 2 Hz steps: wider steps miss harmonics that do not fall on the grid.
    for (let f = 200; f <= 4000; f += 2) {
      let re = 0;
      let im = 0;
      const ww = (2 * Math.PI * f) / SR;
      for (let i = 0; i < a.length; i += 3) {
        re += a[i] * Math.cos(ww * i);
        im += a[i] * Math.sin(ww * i);
      }
      const p = re * re + im * im;
      num += f * p;
      den += p;
    }
    return num / den;
  };
  const c0 = centroid(voice);
  const kept = run(Shift, { semitones: 5, tone: 0, mix: 1, formant: 1 }, voice);
  assert.ok(Math.abs(centroid(kept) / c0 - 1) < 0.12, 'kept ' + (centroid(kept) / c0).toFixed(2));
  // And the pitch still moves: the fundamental is near 150 * 2^(5/12) = 200 Hz.
  assert.ok(Math.abs(zcFreq(kept, 120, 260) - 200) < 6, 'f0 ' + zcFreq(kept, 120, 260));
});

test('with keep formants, the dry signal is delayed like the wet one', () => {
  const { 'astudio-vox-tune': Tune } = processors();
  // A click: with mix 0.5 the dry and wet clicks must land at the same time.
  const sig = new Float32Array(SR);
  sig[1000] = 1;
  const out = run(Tune, { key: 0, scale: 0, retune: 0, mix: 0, formant: 1 }, sig);
  let at = -1;
  for (let i = 0; i < out.length; i++) if (Math.abs(out[i]) > 0.5) { at = i; break; }
  const D = 2 * Math.ceil(SR / 70) + 256;
  assert.equal(at, 1000 + D);
});


// Pitch over time: one value every 20 ms (0 when unvoiced).
function track(sig) {
  const out = [];
  for (let i = 0; i + 2048 <= sig.length; i += SR / 50) out.push(detectPitch(sig.subarray(i, i + 2048), SR));
  return out;
}
const cents = (f, ref) => 1200 * Math.log2(f / ref);
const vibratoSine = (f0, cent, rate, sec) => {
  let ph = 0;
  return Float32Array.from({ length: Math.floor(SR * sec) }, (_, i) => {
    const f = f0 * Math.pow(2, (cent * Math.sin((2 * Math.PI * rate * i) / SR)) / 1200);
    ph += (2 * Math.PI * f) / SR;
    return 0.5 * Math.sin(ph);
  });
};

test('auto tune does not warble between two notes', () => {
  const { 'astudio-vox-tune': Tune } = processors();
  // Singing half way between A (440) and A# (466) with a little vibrato: the output
  // must stay on one note instead of jumping between both.
  const sig = vibratoSine(453, 15, 5, 3);
  const out = run(Tune, { key: 0, scale: 0, retune: 0, mix: 1, formant: 1 }, sig);
  const notes = track(out.subarray(SR)).filter((f) => f > 0).map((f) => Math.round(69 + 12 * Math.log2(f / 440)));
  const changes = notes.filter((n, i) => i && n !== notes[i - 1]).length;
  assert.ok(changes <= 1, 'note changes: ' + changes);
});

test('keep vibrato: 0 flattens the vibrato, 1 keeps it', () => {
  const { 'astudio-vox-tune': Tune } = processors();
  const sig = vibratoSine(440, 40, 5, 3);
  const spread = (out) => {
    const fs = track(out.subarray(SR)).filter((f) => f > 0).map((f) => cents(f, 440));
    return Math.max(...fs) - Math.min(...fs);
  };
  const flat = spread(run(Tune, { key: 9, scale: 0, retune: 0, vibrato: 0, mix: 1, formant: 1 }, sig));
  const kept = spread(run(Tune, { key: 9, scale: 0, retune: 0, vibrato: 1, mix: 1, formant: 1 }, sig));
  assert.ok(flat < 35, 'flattened spread ' + flat.toFixed(0));
  assert.ok(kept > 55, 'kept spread ' + kept.toFixed(0));
});

test('flex tune leaves notes far from the target alone', () => {
  const { 'astudio-vox-tune': Tune } = processors();
  // 40 cents sharp of A: hard tune corrects it, full flex leaves it.
  const sig = sine(440 * Math.pow(2, 40 / 1200), 2);
  const hard = pitchOf(run(Tune, { key: 9, scale: 0, retune: 0, flex: 0, mix: 1, formant: 1 }, sig));
  const flex = pitchOf(run(Tune, { key: 9, scale: 0, retune: 0, flex: 1, mix: 1, formant: 1 }, sig));
  assert.ok(Math.abs(cents(hard, 440)) < 8, 'hard ' + cents(hard, 440).toFixed(1));
  assert.ok(cents(flex, 440) > 30, 'flex ' + cents(flex, 440).toFixed(1));
});

test('MIDI mode follows the notes of the source channel', () => {
  const { 'astudio-vox-tune': Tune } = processors();
  const sig = sine(440, 2);
  // Target C6 (MIDI 72 = 523.25 Hz) for the whole take, though A is in the scale.
  const out = run(Tune, { key: 9, scale: 0, mode: 1, retune: 0, mix: 1, formant: 1 }, sig, (p) => {
    p.port.onmessage({ data: { type: 'target', key: 72, from: 0, to: SR * 10 } });
  });
  const f = pitchOf(out);
  assert.ok(Math.abs(cents(f, 523.25)) < 10, 'got ' + f.toFixed(1));
});

test('added vibrato and formant shift', () => {
  const { 'astudio-vox-tune': Tune } = processors();
  const sig = sine(440, 3);
  const fs = track(run(Tune, { key: 9, scale: 0, retune: 0, vibDepth: 50, vibRate: 5, mix: 1, formant: 1 }, sig).subarray(SR)).filter((f) => f > 0).map((f) => cents(f, 440));
  assert.ok(Math.max(...fs) - Math.min(...fs) > 60, 'vibrato spread ' + (Math.max(...fs) - Math.min(...fs)).toFixed(0));
  // Formant shift keeps the pitch where it is.
  const sh = pitchOf(run(Tune, { key: 9, scale: 0, retune: 0, formantShift: 0.6, mix: 1, formant: 1 }, sig));
  assert.ok(Math.abs(cents(sh, 440)) < 10, 'formant shift moved the pitch: ' + sh.toFixed(1));
});
