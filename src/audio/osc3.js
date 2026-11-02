// 3x Osc: three oscillators (wave, coarse, fine, level) plus noise, shaped by the
// channel envelope and filter. Inspired by the classic three oscillator synth.
export const WAVES = ['sine', 'triangle', 'sawtooth', 'square'];

export function defaultSynth() {
  return { osc: [{ wave: 2, coarse: 0, fine: 0, level: 0.7 }, { wave: 3, coarse: -12, fine: 0, level: 0.4 }, { wave: 2, coarse: 0, fine: 9, level: 0.4 }], noise: 0 };
}

const n = (v, d, a, b) => (Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d);
export function cleanSynth(s) {
  const d = defaultSynth();
  if (!s || typeof s !== 'object') return d;
  return {
    osc: d.osc.map((o, i) => {
      const x = (Array.isArray(s.osc) && s.osc[i]) || {};
      return { wave: Math.round(n(x.wave, o.wave, 0, 3)), coarse: Math.round(n(x.coarse, o.coarse, -36, 36)), fine: Math.round(n(x.fine, o.fine, -100, 100)), level: n(x.level, o.level, 0, 1) };
    }),
    noise: n(s.noise, 0, 0, 1),
  };
}

export const SYNTH_PRESETS = [
  { name: 'Supersaw lead', synth: { osc: [{ wave: 2, coarse: 0, fine: -12, level: 0.6 }, { wave: 2, coarse: 0, fine: 12, level: 0.6 }, { wave: 2, coarse: 12, fine: 0, level: 0.3 }], noise: 0 }, params: { attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.3, cutoff: 0.8, reso: 0.1 } },
  { name: 'Reese bass', synth: { osc: [{ wave: 2, coarse: -12, fine: -8, level: 0.7 }, { wave: 2, coarse: -12, fine: 8, level: 0.7 }, { wave: 0, coarse: -24, fine: 0, level: 0.5 }], noise: 0 }, params: { attack: 0, decay: 0, sustain: 1, release: 0.1, cutoff: 0.45, reso: 0.2 } },
  { name: 'Square lead', synth: { osc: [{ wave: 3, coarse: 0, fine: 0, level: 0.6 }, { wave: 3, coarse: 12, fine: 5, level: 0.25 }, { wave: 1, coarse: -12, fine: 0, level: 0.3 }], noise: 0 }, params: { attack: 0, decay: 0.2, sustain: 0.7, release: 0.15, cutoff: 0.75, reso: 0.15 } },
  { name: 'Soft pad', synth: { osc: [{ wave: 1, coarse: 0, fine: -6, level: 0.5 }, { wave: 2, coarse: 0, fine: 6, level: 0.35 }, { wave: 0, coarse: 12, fine: 0, level: 0.3 }], noise: 0.03 }, params: { attack: 0.6, decay: 0.5, sustain: 0.8, release: 1.2, cutoff: 0.55, reso: 0.1 } },
  { name: 'Pluck', synth: { osc: [{ wave: 2, coarse: 0, fine: 0, level: 0.7 }, { wave: 3, coarse: 12, fine: 0, level: 0.2 }, { wave: 0, coarse: 0, fine: 0, level: 0.3 }], noise: 0.05 }, params: { attack: 0, decay: 0.25, sustain: 0, release: 0.2, cutoff: 0.6, reso: 0.25 } },
  { name: 'Sub bass', synth: { osc: [{ wave: 0, coarse: -12, fine: 0, level: 0.9 }, { wave: 1, coarse: -12, fine: 0, level: 0.2 }, { wave: 0, coarse: 0, fine: 0, level: 0 }], noise: 0 }, params: { attack: 0, decay: 0, sustain: 1, release: 0.15, cutoff: 0.5, reso: 0 } },
];

let noiseBuf = null;
// Instrument object for the generic note code (envelope, glide and filter are applied there).
export function osc3Instrument(channel) {
  const syn = cleanSynth(channel.synth);
  return {
    release: 0.05,
    play(ctx, out, t, f, vel) {
      const sources = [];
      const total = syn.osc.reduce((a, o) => a + o.level, 0) + syn.noise;
      const norm = (0.55 * vel) / Math.max(1, total);
      for (const o of syn.osc) {
        if (o.level <= 0) continue;
        const osc = ctx.createOscillator();
        osc.type = WAVES[o.wave];
        osc.frequency.setValueAtTime(f * Math.pow(2, o.coarse / 12), t);
        osc.detune.setValueAtTime(o.fine, t);
        const g = ctx.createGain();
        g.gain.value = o.level * norm;
        osc.connect(g);
        g.connect(out);
        osc.start(t);
        sources.push(osc);
      }
      if (syn.noise > 0) {
        if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
          noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
          const d = noiseBuf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        const s = ctx.createBufferSource();
        s.buffer = noiseBuf;
        s.loop = true;
        const g = ctx.createGain();
        g.gain.value = syn.noise * norm;
        s.connect(g);
        g.connect(out);
        s.start(t);
        sources.push(s);
      }
      if (!sources.length) {
        const s = ctx.createConstantSource();
        s.offset.value = 0;
        s.connect(out);
        s.start(t);
        sources.push(s);
      }
      return { sources, length: 0 };
    },
  };
}
