// Effects that ship with the app. They use the plugin shape (id, name, params)
// so the FX slots and controls treat them like effect plugins, but they are
// built from native Web Audio nodes instead of an AudioWorklet.
import { t } from '../i18n.js';

const knob = (id, name, min, max, def) => ({ kind: 'knob', id, name, min, max, def });
const choice = (id, name, options, def = 0) => ({ kind: 'choice', id, name, options, min: 0, max: options.length - 1, def });

const db = (v) => Math.pow(10, v / 20);

function curve(drive, kind) {
  const n = 2048;
  const c = new Float32Array(n);
  const k = 1 + drive * 40;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    if (kind === 1) c[i] = Math.max(-1, Math.min(1, x * k)) * 0.9; // hard clip
    else if (kind === 2) c[i] = Math.sin(Math.min(Math.PI / 2, Math.max(-Math.PI / 2, x * k * 0.5))); // fold soft
    else c[i] = Math.tanh(x * k) / Math.tanh(k); // tape like
  }
  return c;
}

export const BUILTIN_EFFECTS = [
  {
    id: 'astudio-compressor',
    name: 'Compressor',
    params: [knob('threshold', 'Threshold dB', -60, 0, -18), knob('ratio', 'Ratio', 1, 20, 4), knob('attack', 'Attack ms', 0, 200, 10), knob('release', 'Release ms', 10, 1000, 150), knob('makeup', 'Gain dB', 0, 24, 3)],
    presets: [
      { name: 'Gentle bus', values: { threshold: -14, ratio: 2, attack: 30, release: 200, makeup: 2 } },
      { name: 'Punchy drums', values: { threshold: -22, ratio: 6, attack: 15, release: 90, makeup: 6 } },
      { name: 'Vocal', values: { threshold: -20, ratio: 4, attack: 5, release: 120, makeup: 5 } },
    ],
    create(ctx) {
      const comp = ctx.createDynamicsCompressor();
      const out = ctx.createGain();
      comp.connect(out);
      return {
        input: comp,
        output: out,
        set(v) {
          comp.threshold.value = v.threshold;
          comp.ratio.value = v.ratio;
          comp.knee.value = 6;
          comp.attack.value = v.attack / 1000;
          comp.release.value = v.release / 1000;
          out.gain.value = db(v.makeup);
        },
      };
    },
  },
  {
    id: 'astudio-limiter',
    name: 'Limiter',
    params: [knob('gain', 'Input dB', 0, 24, 0), knob('ceiling', 'Ceiling dB', -12, 0, -0.3)],
    presets: [{ name: 'Loud', values: { gain: 6, ceiling: -0.3 } }],
    create(ctx) {
      const pre = ctx.createGain();
      const lim = ctx.createDynamicsCompressor();
      const out = ctx.createGain();
      lim.knee.value = 0;
      lim.ratio.value = 20;
      lim.attack.value = 0.001;
      lim.release.value = 0.08;
      pre.connect(lim);
      lim.connect(out);
      return {
        input: pre,
        output: out,
        set(v) {
          pre.gain.value = db(v.gain);
          lim.threshold.value = v.ceiling - 1;
          out.gain.value = db(v.ceiling) / db(v.ceiling - 1);
        },
      };
    },
  },
  {
    id: 'astudio-filter',
    name: 'Filter',
    params: [choice('type', 'Type', ['Low pass', 'High pass', 'Band pass', 'Notch']), knob('cutoff', 'Cutoff', 0, 1, 0.7), knob('reso', 'Resonance', 0, 1, 0.2)],
    presets: [{ name: 'Telephone', values: { type: 2, cutoff: 0.55, reso: 0.4 } }, { name: 'Remove lows', values: { type: 1, cutoff: 0.18, reso: 0.1 } }],
    create(ctx) {
      const f = ctx.createBiquadFilter();
      return {
        input: f,
        output: f,
        set(v) {
          f.type = ['lowpass', 'highpass', 'bandpass', 'notch'][v.type] || 'lowpass';
          f.frequency.value = 30 * Math.pow(18000 / 30, v.cutoff);
          f.Q.value = 0.5 + v.reso * 15;
        },
      };
    },
  },
  {
    id: 'astudio-distortion',
    name: 'Distortion',
    params: [choice('mode', 'Mode', ['Soft', 'Hard', 'Fold']), knob('drive', 'Drive', 0, 1, 0.3), knob('tone', 'Tone', 0, 1, 0.7), knob('mix', 'Mix', 0, 1, 1)],
    presets: [{ name: 'Warm 808', values: { mode: 0, drive: 0.25, tone: 0.5, mix: 0.6 } }, { name: 'Crushed', values: { mode: 1, drive: 0.8, tone: 0.8, mix: 1 } }],
    create(ctx) {
      const input = ctx.createGain();
      const shaper = ctx.createWaveShaper();
      shaper.oversample = '2x';
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      const wet = ctx.createGain();
      const dry = ctx.createGain();
      const out = ctx.createGain();
      input.connect(shaper);
      shaper.connect(tone);
      tone.connect(wet);
      wet.connect(out);
      input.connect(dry);
      dry.connect(out);
      let key = '';
      return {
        input,
        output: out,
        set(v) {
          const k = v.mode + ':' + v.drive;
          if (k !== key) {
            shaper.curve = curve(v.drive, v.mode);
            key = k;
          }
          tone.frequency.value = 800 * Math.pow(20, v.tone);
          wet.gain.value = v.mix;
          dry.gain.value = 1 - v.mix;
        },
      };
    },
  },
  {
    id: 'astudio-sidechain',
    name: 'Sidechain',
    // The source channel is chosen in the FX window (slot.source); every note of
    // that channel ducks this insert, like a kick pumping the bass.
    sidechain: true,
    params: [knob('depth', 'Depth', 0, 1, 0.7), knob('release', 'Release ms', 20, 800, 180), knob('attack', 'Attack ms', 0, 50, 4)],
    presets: [{ name: 'Pump', values: { depth: 0.85, release: 220, attack: 3 } }, { name: 'Subtle', values: { depth: 0.4, release: 140, attack: 5 } }],
    create(ctx) {
      const g = ctx.createGain();
      const self = {
        input: g,
        output: g,
        gain: g.gain,
        values: { depth: 0.7, release: 180, attack: 4 },
        set(v) {
          self.values = v;
        },
        // Schedule one duck at time t.
        duck(t) {
          const { depth, release, attack } = self.values;
          const a = Math.max(0.001, attack / 1000);
          g.gain.cancelScheduledValues(t);
          g.gain.setTargetAtTime(1 - depth, t, a / 3);
          g.gain.setTargetAtTime(1, t + a, release / 3000);
        },
      };
      return self;
    },
  },
].map((fx) => ({ ...fx, type: 'effect', builtin: true, version: '1.0.0', author: 'A Studio', category: t('Built in'), code: '' }));

export const getBuiltinEffect = (id) => BUILTIN_EFFECTS.find((x) => x.id === id) || null;
