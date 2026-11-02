// Effects that ship with the app. They use the plugin shape (id, name, params)
// so the FX slots and controls treat them like effect plugins, but they are
// built from native Web Audio nodes instead of an AudioWorklet.
import { t } from '../i18n.js';

const knob = (id, name, min, max, def) => ({ kind: 'knob', id, name, min, max, def });
const toggle = (id, name, def = 0) => ({ kind: 'toggle', id, name, min: 0, max: 1, def });
const choice = (id, name, options, def = 0) => ({ kind: 'choice', id, name, options, min: 0, max: options.length - 1, def });

const db = (v) => Math.pow(10, v / 20);
// DynamicsCompressorNode adds its own makeup gain (Web Audio spec: the inverse of the
// gain at 0 dBFS, raised to 0.6). Returns it in dB so the effects can cancel it.
export const autoMakeupDb = (threshold, ratio) => 0.6 * -threshold * (1 - 1 / ratio);

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
          out.gain.value = db(v.makeup - autoMakeupDb(v.threshold, v.ratio));
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
          // The native compressor lets short peaks through: keep a 2 dB margin under the ceiling.
          pre.gain.value = db(v.gain);
          lim.threshold.value = v.ceiling - 2;
          out.gain.value = db(-autoMakeupDb(v.ceiling - 2, 20));
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
  // Vocal effects
  {
    id: 'astudio-autotune',
    name: 'Auto tune',
    vocal: true,
    worklet: 'astudio-vox-tune',
    params: [choice('key', 'Key', ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']), choice('scale', 'Scale', ['Chromatic', 'Major', 'Minor', 'Harmonic minor', 'Major pentatonic', 'Minor pentatonic', 'Blues']), knob('retune', 'Retune ms', 0, 400, 20), knob('mix', 'Mix', 0, 1, 1), toggle('formant', 'Keep formants', 1)],
    presets: [
      { name: 'Hard tune (robotic)', values: { retune: 0, mix: 1 } },
      { name: 'Natural', values: { retune: 120, mix: 1 } },
      { name: 'Light touch', values: { retune: 250, mix: 0.7 } },
    ],
  },
  {
    id: 'astudio-pitch',
    name: 'Voice changer',
    vocal: true,
    worklet: 'astudio-vox-shift',
    params: [knob('semitones', 'Semitones', -12, 12, 0), knob('tone', 'Tone', -1, 1, 0), knob('mix', 'Mix', 0, 1, 1), toggle('formant', 'Keep formants', 0)],
    presets: [
      { name: 'Deep voice', values: { semitones: -5, tone: -0.5, mix: 1, formant: 0 } },
      { name: 'Natural lower', values: { semitones: -3, tone: 0, mix: 1, formant: 1 } },
      { name: 'Natural higher', values: { semitones: 3, tone: 0, mix: 1, formant: 1 } },
      { name: 'Monster', values: { semitones: -10, tone: -0.8, mix: 1 } },
      { name: 'Chipmunk', values: { semitones: 7, tone: 0.5, mix: 1 } },
      { name: 'Octave up layer', values: { semitones: 12, tone: 0, mix: 0.35 } },
      { name: 'Octave down layer', values: { semitones: -12, tone: -0.2, mix: 0.4 } },
    ],
  },
  {
    id: 'astudio-harmonizer',
    name: 'Harmonizer',
    vocal: true,
    worklet: 'astudio-vox-harmony',
    params: [knob('voiceA', 'Voice 1 semitones', -12, 12, 4), knob('voiceB', 'Voice 2 semitones', -12, 12, 7), knob('level', 'Level', 0, 1, 0.5)],
    presets: [
      { name: 'Major third and fifth', values: { voiceA: 4, voiceB: 7, level: 0.5 } },
      { name: 'Minor third and fifth', values: { voiceA: 3, voiceB: 7, level: 0.5 } },
      { name: 'Octaves', values: { voiceA: 12, voiceB: -12, level: 0.4 } },
      { name: 'Fifth below', values: { voiceA: -5, voiceB: 0, level: 0.5 } },
    ],
  },
  {
    id: 'astudio-gate',
    name: 'Noise gate',
    vocal: true,
    worklet: 'astudio-vox-gate',
    params: [knob('threshold', 'Threshold dB', -80, 0, -45), knob('release', 'Release ms', 5, 1000, 120)],
    presets: [{ name: 'Quiet room', values: { threshold: -50, release: 150 } }, { name: 'Noisy room', values: { threshold: -35, release: 80 } }],
  },
  {
    id: 'astudio-deesser',
    name: 'De-esser',
    vocal: true,
    worklet: 'astudio-vox-deess',
    params: [knob('freq', 'Frequency Hz', 3000, 10000, 6000), knob('threshold', 'Threshold dB', -60, 0, -30), knob('amount', 'Amount', 0, 1, 0.7)],
    presets: [{ name: 'Soft', values: { freq: 6500, threshold: -28, amount: 0.5 } }, { name: 'Strong', values: { freq: 5500, threshold: -36, amount: 0.9 } }],
  },
  {
    id: 'astudio-doubler',
    name: 'Doubler',
    vocal: true,
    params: [knob('width', 'Width', 0, 1, 0.8), knob('depth', 'Detune', 0, 1, 0.4), knob('mix', 'Mix', 0, 1, 0.5)],
    presets: [{ name: 'Wide chorus', values: { width: 1, depth: 0.6, mix: 0.6 } }, { name: 'Subtle double', values: { width: 0.7, depth: 0.3, mix: 0.35 } }],
    create(ctx) {
      const input = ctx.createGain();
      const out = ctx.createGain();
      const dry = ctx.createGain();
      input.connect(dry);
      dry.connect(out);
      const voices = [[0.017, 0.31, -1], [0.026, 0.47, 1]].map(([base, rate, side]) => {
        const d = ctx.createDelay(0.1);
        d.delayTime.value = base;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = rate;
        const depth = ctx.createGain();
        lfo.connect(depth);
        depth.connect(d.delayTime);
        lfo.start();
        const pan = ctx.createStereoPanner();
        const g = ctx.createGain();
        input.connect(d);
        d.connect(pan);
        pan.connect(g);
        g.connect(out);
        return { depth, pan, g, side };
      });
      return {
        input,
        output: out,
        set(v) {
          dry.gain.value = 1 - v.mix * 0.4;
          for (const x of voices) {
            x.depth.gain.value = 0.004 * v.depth;
            x.pan.pan.value = x.side * v.width;
            x.g.gain.value = v.mix * 0.8;
          }
        },
      };
    },
  },
  {
    id: 'astudio-reverb',
    name: 'Reverb',
    vocal: true,
    params: [knob('size', 'Size s', 0.3, 6, 2), knob('damp', 'Damping', 0, 1, 0.4), knob('predelay', 'Pre delay ms', 0, 150, 20), knob('mix', 'Mix', 0, 1, 0.25)],
    presets: [
      { name: 'Vocal plate', values: { size: 1.8, damp: 0.3, predelay: 30, mix: 0.22 } },
      { name: 'Small room', values: { size: 0.6, damp: 0.6, predelay: 5, mix: 0.2 } },
      { name: 'Big hall', values: { size: 4.5, damp: 0.4, predelay: 60, mix: 0.3 } },
    ],
    create(ctx) {
      const input = ctx.createGain();
      const out = ctx.createGain();
      const dry = ctx.createGain();
      const pre = ctx.createDelay(0.5);
      const conv = ctx.createConvolver();
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      const wet = ctx.createGain();
      input.connect(dry);
      dry.connect(out);
      input.connect(pre);
      pre.connect(conv);
      conv.connect(damp);
      damp.connect(wet);
      wet.connect(out);
      let size = 0;
      return {
        input,
        output: out,
        set(v) {
          if (Math.abs(v.size - size) > 0.05) {
            size = v.size;
            const sr = ctx.sampleRate;
            const len = Math.floor(sr * size);
            const b = ctx.createBuffer(2, len, sr);
            for (let c = 0; c < 2; c++) {
              const d = b.getChannelData(c);
              for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
            }
            conv.buffer = b;
          }
          damp.frequency.value = 18000 * Math.pow(1500 / 18000, v.damp);
          pre.delayTime.value = v.predelay / 1000;
          wet.gain.value = v.mix * 1.2;
          dry.gain.value = 1 - v.mix * 0.5;
        },
      };
    },
  },
  {
    id: 'astudio-echo',
    name: 'Echo',
    vocal: true,
    tempo: true,
    params: [choice('time', 'Time', ['1/4', '1/8', '1/8 dotted', '1/16', '1/4 dotted', '1/2'], 2), knob('feedback', 'Feedback', 0, 0.9, 0.35), knob('tone', 'Tone', 0, 1, 0.6), knob('mix', 'Mix', 0, 1, 0.25)],
    presets: [{ name: 'Slap back', values: { time: 3, feedback: 0.1, tone: 0.7, mix: 0.25 } }, { name: 'Trap echo', values: { time: 2, feedback: 0.45, tone: 0.5, mix: 0.3 } }],
    create(ctx) {
      const input = ctx.createGain();
      const out = ctx.createGain();
      const del = ctx.createDelay(4);
      const fb = ctx.createGain();
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      const wet = ctx.createGain();
      input.connect(out);
      input.connect(del);
      del.connect(tone);
      tone.connect(fb);
      fb.connect(del);
      tone.connect(wet);
      wet.connect(out);
      return {
        input,
        output: out,
        set(v, bpm = 120) {
          const beats = [1, 0.5, 0.75, 0.25, 1.5, 2][v.time] || 0.75;
          del.delayTime.value = Math.min(4, (60 / bpm) * beats);
          fb.gain.value = v.feedback;
          tone.frequency.value = 1000 * Math.pow(16, v.tone);
          wet.gain.value = v.mix;
        },
      };
    },
  },
  {
    id: 'astudio-robot',
    name: 'Robot voice',
    vocal: true,
    params: [knob('freq', 'Frequency Hz', 20, 400, 90), knob('mix', 'Mix', 0, 1, 0.8)],
    presets: [{ name: 'Robot', values: { freq: 60, mix: 1 } }, { name: 'Metallic', values: { freq: 230, mix: 0.6 } }],
    create(ctx) {
      // Ring modulation: the voice is multiplied by a sine wave.
      const input = ctx.createGain();
      const out = ctx.createGain();
      const dry = ctx.createGain();
      const ring = ctx.createGain();
      ring.gain.value = 0;
      const osc = ctx.createOscillator();
      osc.connect(ring.gain);
      osc.start();
      const wet = ctx.createGain();
      input.connect(dry);
      dry.connect(out);
      input.connect(ring);
      ring.connect(wet);
      wet.connect(out);
      return {
        input,
        output: out,
        set(v) {
          osc.frequency.value = v.freq;
          wet.gain.value = v.mix * 1.4;
          dry.gain.value = 1 - v.mix;
        },
      };
    },
  },
].map((fx) => ({ ...fx, type: 'effect', builtin: true, version: '1.0.0', author: 'A Studio', category: t('Built in'), code: '' }));

// Effects running in the vocal AudioWorklet module (see voxworklet.js).
for (const fx of BUILTIN_EFFECTS) {
  if (!fx.worklet) continue;
  fx.create = (ctx, params) => {
    const node = new AudioWorkletNode(ctx, fx.worklet, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { params } });
    return { input: node, output: node, node, set: (v) => node.port.postMessage({ type: 'params', values: v }) };
  };
}

export const getBuiltinEffect = (id) => BUILTIN_EFFECTS.find((x) => x.id === id) || null;
