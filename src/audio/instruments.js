// Synthesized instruments.
// play(ctx, out, t, freq, vel, dur) connects to `out` and returns
// { sources, length }. `sources` are stopped by the voice wrapper when the
// note ends; short transients stop themselves. `length` is the natural length
// in seconds (undefined for sustained sounds).

const C5F = 261.6256;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function noiseBuffer(ctx) {
  if (ctx.__noise) return ctx.__noise;
  const len = ctx.sampleRate * 2;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  ctx.__noise = b;
  return b;
}

function periodic(ctx, name, harm) {
  const cache = ctx.__waves || (ctx.__waves = {});
  if (cache[name]) return cache[name];
  const real = new Float32Array(harm.length + 1);
  const imag = new Float32Array(harm.length + 1);
  harm.forEach((a, i) => {
    imag[i + 1] = a;
  });
  cache[name] = ctx.createPeriodicWave(real, imag);
  return cache[name];
}

function osc(ctx, t, freq, type = 'sine', detune = 0) {
  const o = ctx.createOscillator();
  if (typeof type === 'string') o.type = type;
  else o.setPeriodicWave(type);
  o.frequency.setValueAtTime(freq, t);
  if (detune) o.detune.setValueAtTime(detune, t);
  o.start(t);
  return o;
}

function gain(ctx, v, dest) {
  const g = ctx.createGain();
  g.gain.value = v;
  if (dest) g.connect(dest);
  return g;
}

function filter(ctx, type, f, q, dest) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  if (dest) b.connect(dest);
  return b;
}

function noise(ctx, t, dest, dur) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  s.loop = true;
  s.connect(dest);
  s.start(t, Math.random() * 1.5);
  if (dur) s.stop(t + dur);
  return s;
}

function adsr(param, t, peak, a, d, s) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(peak * s, t + a, d / 3);
}

function vibrato(ctx, t, rate, cents, targets, delay = 0) {
  const lfo = osc(ctx, t, rate);
  const g = gain(ctx, 0);
  if (delay) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(cents, t + delay);
  } else g.gain.value = cents;
  lfo.connect(g);
  for (const o of targets) g.connect(o.detune);
  return lfo;
}

function metal(ctx, out, t, r, vel, decay, hp) {
  const freqs = [205.3, 304.4, 369.6, 522.7, 540, 800];
  const mix = gain(ctx, 0.3);
  const bp = filter(ctx, 'bandpass', 10000, 0.8);
  const hpf = filter(ctx, 'highpass', hp, 0.7);
  const g = gain(ctx, 0, out);
  mix.connect(bp);
  bp.connect(hpf);
  hpf.connect(g);
  g.gain.setValueAtTime(vel * 0.6, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  return freqs.map((f) => {
    const o = osc(ctx, t, f * r, 'square');
    o.connect(mix);
    return o;
  });
}

const softClip = (() => {
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 1023) * 2 - 1;
    curve[i] = Math.tanh(x * 1.8);
  }
  return curve;
})();

function ksBuffer(ctx, f, vel) {
  const sr = ctx.sampleRate;
  const N = Math.max(2, Math.floor(sr / f - 0.5));
  const bucket = Math.round(vel * 4);
  const cache = ctx.__ks || (ctx.__ks = new Map());
  const key = N + ':' + bucket;
  let buf = cache.get(key);
  if (!buf) {
    const len = Math.floor(sr * 2.5);
    buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const bright = 0.25 + (bucket / 4) * 0.65;
    let prev = 0;
    for (let i = 0; i < N; i++) {
      prev += bright * (Math.random() * 2 - 1 - prev);
      d[i] = prev;
    }
    const damp = 0.996;
    for (let i = N; i < len; i++) {
      const a = d[i - N];
      const b = i - N - 1 >= 0 ? d[i - N - 1] : 0;
      d[i] = damp * 0.5 * (a + b);
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0) for (let i = 0; i < len; i++) d[i] *= 0.8 / peak;
    cache.set(key, buf);
  }
  return { buf, rate: f / (sr / (N + 0.5)) };
}

const keyOf = (f) => 69 + 12 * Math.log2(f / 440);

export const INSTRUMENTS = {
  // Drums: one shots, pitch relative to C5.
  kick: {
    oneShot: true,
    play(ctx, out, t, f, vel) {
      const r = f / C5F;
      const g = gain(ctx, 0, out);
      g.gain.setValueAtTime(vel, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      const o = osc(ctx, t, 150 * r);
      o.frequency.exponentialRampToValueAtTime(48 * r, t + 0.13);
      o.connect(g);
      const cg = gain(ctx, 0, out);
      cg.gain.setValueAtTime(0.25 * vel, t);
      cg.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
      noise(ctx, t, filter(ctx, 'highpass', 1200, 0.7, cg), 0.02);
      return { sources: [o], length: 0.55 };
    },
  },
  snare: {
    oneShot: true,
    play(ctx, out, t, f, vel) {
      const r = f / C5F;
      const tg = gain(ctx, 0, out);
      tg.gain.setValueAtTime(vel * 0.5, t);
      tg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      const o = osc(ctx, t, 185 * r, 'triangle');
      o.frequency.exponentialRampToValueAtTime(150 * r, t + 0.08);
      o.connect(tg);
      const ng = gain(ctx, 0, out);
      ng.gain.setValueAtTime(vel * 0.55, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      const n = noise(ctx, t, filter(ctx, 'highpass', 1800 * r, 0.7, ng));
      return { sources: [o, n], length: 0.26 };
    },
  },
  clap: {
    oneShot: true,
    play(ctx, out, t, f, vel) {
      const r = f / C5F;
      const g = gain(ctx, 0, out);
      const bp = filter(ctx, 'bandpass', 1150 * r, 0.9);
      bp.connect(filter(ctx, 'highpass', 500, 0.7, g));
      const v = vel * 0.9;
      g.gain.setValueAtTime(0, t);
      for (let i = 0; i < 3; i++) {
        const tt = t + i * 0.011;
        g.gain.setValueAtTime(v, tt);
        g.gain.exponentialRampToValueAtTime(v * 0.15, tt + 0.009);
      }
      g.gain.setValueAtTime(v * 0.8, t + 0.033);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      const n = noise(ctx, t, bp);
      return { sources: [n], length: 0.28 };
    },
  },
  hat: {
    oneShot: true,
    play(ctx, out, t, f, vel) {
      return { sources: metal(ctx, out, t, f / C5F, vel * 0.8, 0.06, 7000), length: 0.08 };
    },
  },
  ohat: {
    oneShot: true,
    play(ctx, out, t, f, vel) {
      return { sources: metal(ctx, out, t, f / C5F, vel * 0.7, 0.4, 7000), length: 0.45 };
    },
  },
  crash: {
    oneShot: true,
    play(ctx, out, t, f, vel) {
      const r = f / C5F;
      const srcs = metal(ctx, out, t, r * 1.3, vel * 0.5, 1.5, 5000);
      const g = gain(ctx, 0, out);
      g.gain.setValueAtTime(vel * 0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
      srcs.push(noise(ctx, t, filter(ctx, 'highpass', 6000, 0.7, g)));
      return { sources: srcs, length: 1.6 };
    },
  },
  tom: {
    oneShot: true,
    play(ctx, out, t, f, vel) {
      const r = f / C5F;
      const g = gain(ctx, 0, out);
      g.gain.setValueAtTime(vel * 0.8, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      const o = osc(ctx, t, 170 * r);
      o.frequency.exponentialRampToValueAtTime(105 * r, t + 0.3);
      o.connect(g);
      return { sources: [o], length: 0.45 };
    },
  },
  rim: {
    oneShot: true,
    play(ctx, out, t, f, vel) {
      const r = f / C5F;
      const g = gain(ctx, 0, out);
      g.gain.setValueAtTime(vel * 0.6, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      const o = osc(ctx, t, 1750 * r, 'triangle');
      o.connect(g);
      const ng = gain(ctx, 0, out);
      ng.gain.setValueAtTime(vel * 0.3, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      noise(ctx, t, filter(ctx, 'bandpass', 3000, 1.5, ng), 0.04);
      return { sources: [o], length: 0.06 };
    },
  },
  cowbell: {
    oneShot: true,
    play(ctx, out, t, f, vel) {
      const r = f / C5F;
      const g = gain(ctx, 0, out);
      g.gain.setValueAtTime(vel * 0.35, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      const bp = filter(ctx, 'bandpass', 2600 * r, 1, g);
      const a = osc(ctx, t, 540 * r, 'square');
      const b = osc(ctx, t, 800 * r, 'square');
      a.connect(bp);
      b.connect(bp);
      return { sources: [a, b], length: 0.4 };
    },
  },

  // Keys
  piano: {
    release: 0.3,
    play(ctx, out, t, f, vel) {
      const key = keyOf(f);
      const decay = clamp(5.5 - (key - 36) * 0.07, 0.6, 7);
      const g = gain(ctx, 0, out);
      const peak = 0.32 * (0.35 + vel * 0.65);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.003);
      g.gain.setTargetAtTime(peak * 0.45, t + 0.003, 0.09);
      g.gain.setTargetAtTime(0, t + 0.3, decay / 3);
      const lp = filter(ctx, 'lowpass', Math.min(16000, f * (3 + vel * 12)), 0.5, g);
      lp.frequency.setTargetAtTime(Math.max(f * 2, 700), t + 0.01, decay / 2.5);
      const w = periodic(ctx, 'piano', [1, 0.6, 0.35, 0.25, 0.17, 0.11, 0.08, 0.05, 0.035, 0.022, 0.015]);
      const o1 = osc(ctx, t, f, w, 2.5);
      const o2 = osc(ctx, t, f, w, -2.5);
      const o3 = osc(ctx, t, f * 2, 'sine', 1);
      const g3 = gain(ctx, 0.12, lp);
      o1.connect(lp);
      o2.connect(lp);
      o3.connect(g3);
      const hg = gain(ctx, 0, out);
      hg.gain.setValueAtTime(0.06 * vel, t);
      hg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      noise(ctx, t, filter(ctx, 'bandpass', clamp(f * 4, 800, 6000), 1.2, hg), 0.04);
      return { sources: [o1, o2, o3], length: decay * 2.2 + 0.3 };
    },
  },
  epiano: {
    release: 0.35,
    play(ctx, out, t, f, vel) {
      const key = keyOf(f);
      const g = gain(ctx, 0, out);
      const peak = 0.28 * (0.4 + vel * 0.6);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.003);
      g.gain.setTargetAtTime(0, t + 0.003, clamp(2 - (key - 48) * 0.025, 0.4, 2.5));
      const car = osc(ctx, t, f);
      car.connect(g);
      const mod = osc(ctx, t, f);
      const mg = gain(ctx, 0);
      mg.gain.setValueAtTime(f * (0.6 + vel * 1.6), t);
      mg.gain.setTargetAtTime(f * 0.12, t, 0.35);
      mod.connect(mg);
      mg.connect(car.frequency);
      const tine = osc(ctx, t, f * 14);
      const tg = gain(ctx, 0);
      tg.gain.setValueAtTime(f * vel * 1.2, t);
      tg.gain.setTargetAtTime(0, t, 0.02);
      tine.connect(tg);
      tg.connect(car.frequency);
      return { sources: [car, mod, tine], length: 6 };
    },
  },
  organ: {
    release: 0.08,
    play(ctx, out, t, f, vel) {
      const w = periodic(ctx, 'organ', [1, 0.75, 0.55, 0.4, 0, 0.3, 0, 0.22]);
      const o = osc(ctx, t, f, w);
      const lfo = vibrato(ctx, t, 5.8, 6, [o]);
      const g = gain(ctx, 0, out);
      adsr(g.gain, t, 0.16 * (0.6 + vel * 0.4), 0.008, 0.1, 0.9);
      o.connect(g);
      return { sources: [o, lfo] };
    },
  },

  // Basses
  bass: {
    release: 0.06,
    play(ctx, out, t, f, vel) {
      const g = gain(ctx, 0, out);
      adsr(g.gain, t, 0.22 * (0.5 + vel * 0.5), 0.004, 0.3, 0.7);
      const lp = filter(ctx, 'lowpass', 300 + vel * 2200, 2, g);
      lp.frequency.setTargetAtTime(380, t + 0.005, 0.15);
      const a = osc(ctx, t, f, 'sawtooth');
      const b = osc(ctx, t, f / 2, 'square');
      const bg = gain(ctx, 0.5, lp);
      a.connect(lp);
      b.connect(bg);
      return { sources: [a, b] };
    },
  },
  sub808: {
    release: 0.12,
    play(ctx, out, t, f, vel) {
      const g = gain(ctx, 0, out);
      g.gain.setValueAtTime(vel * 0.7, t);
      g.gain.setTargetAtTime(0, t + 0.05, 0.7);
      const ws = ctx.createWaveShaper();
      ws.curve = softClip;
      ws.connect(g);
      const o = osc(ctx, t, f * 2.2);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
      o.connect(ws);
      return { sources: [o], length: 3 };
    },
  },

  // Synths
  lead: {
    release: 0.08,
    play(ctx, out, t, f, vel) {
      const g = gain(ctx, 0, out);
      adsr(g.gain, t, 0.1 * (0.5 + vel * 0.5), 0.004, 0.2, 0.75);
      const lp = filter(ctx, 'lowpass', 2500 + vel * 3500, 1, g);
      const a = osc(ctx, t, f, 'square');
      const b = osc(ctx, t, f, 'sawtooth', 8);
      a.connect(lp);
      b.connect(lp);
      return { sources: [a, b] };
    },
  },
  pad: {
    release: 0.9,
    play(ctx, out, t, f, vel) {
      const g = gain(ctx, 0, out);
      adsr(g.gain, t, 0.08 * (0.6 + vel * 0.4), 0.6, 1, 0.9);
      const lp = filter(ctx, 'lowpass', 900 + vel * 900, 0.8, g);
      const a = osc(ctx, t, f, 'sawtooth', -14);
      const b = osc(ctx, t, f, 'sawtooth', 14);
      const c = osc(ctx, t, f / 2, 'triangle');
      a.connect(lp);
      b.connect(lp);
      c.connect(lp);
      const lfo = vibrato(ctx, t, 0.3, 8, [a, b]);
      return { sources: [a, b, c, lfo] };
    },
  },
  pluck: {
    release: 0.1,
    play(ctx, out, t, f, vel) {
      const g = gain(ctx, 0, out);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.2 * (0.5 + vel * 0.5), t + 0.002);
      g.gain.setTargetAtTime(0, t + 0.002, 0.3);
      const lp = filter(ctx, 'lowpass', 800 + vel * 7000, 1.5, g);
      lp.frequency.setTargetAtTime(500, t + 0.002, 0.12);
      const a = osc(ctx, t, f, 'sawtooth');
      const b = osc(ctx, t, f, 'square', -5);
      a.connect(lp);
      b.connect(lp);
      return { sources: [a, b], length: 2.2 };
    },
  },

  // Strings
  strings: {
    release: 0.5,
    play(ctx, out, t, f, vel) {
      const g = gain(ctx, 0, out);
      adsr(g.gain, t, 0.07 * (0.6 + vel * 0.4), 0.3, 0.4, 0.85);
      const lp = filter(ctx, 'lowpass', 1800 + vel * 2500, 0.6, g);
      const oscs = [-10, 0, 10].map((d) => {
        const o = osc(ctx, t, f, 'sawtooth', d);
        o.connect(lp);
        return o;
      });
      const lfo = vibrato(ctx, t, 5, 5, oscs, 0.4);
      return { sources: [...oscs, lfo] };
    },
  },
  guitar: {
    release: 0.1,
    play(ctx, out, t, f, vel) {
      const { buf, rate } = ksBuffer(ctx, f, vel);
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = rate;
      const g = gain(ctx, 0.5 * (0.4 + vel * 0.6), out);
      s.connect(g);
      s.start(t);
      return { sources: [s], length: 2.4 };
    },
  },

  // Winds
  flute: {
    release: 0.12,
    play(ctx, out, t, f, vel) {
      const g = gain(ctx, 0, out);
      adsr(g.gain, t, 0.18 * (0.5 + vel * 0.5), 0.07, 0.2, 0.85);
      const a = osc(ctx, t, f);
      const b = osc(ctx, t, f * 2);
      const bg = gain(ctx, 0.15, g);
      a.connect(g);
      b.connect(bg);
      const ng = gain(ctx, 0.05, g);
      const n = noise(ctx, t, filter(ctx, 'bandpass', Math.min(f * 1.5, 12000), 2, ng));
      const lfo = vibrato(ctx, t, 5, 10, [a, b], 0.5);
      return { sources: [a, b, n, lfo] };
    },
  },
  brass: {
    release: 0.15,
    play(ctx, out, t, f, vel) {
      const g = gain(ctx, 0, out);
      adsr(g.gain, t, 0.12 * (0.5 + vel * 0.5), 0.03, 0.2, 0.8);
      const lp = filter(ctx, 'lowpass', 300, 1, g);
      lp.frequency.setValueAtTime(300, t);
      lp.frequency.linearRampToValueAtTime(2800 + vel * 2000, t + 0.07);
      lp.frequency.setTargetAtTime(1600 + vel * 800, t + 0.07, 0.2);
      const a = osc(ctx, t, f, 'sawtooth');
      const b = osc(ctx, t, f, 'sawtooth', 6);
      a.connect(lp);
      b.connect(lp);
      return { sources: [a, b] };
    },
  },

  // Mallets
  marimba: {
    release: 0.15,
    play(ctx, out, t, f, vel) {
      const g = gain(ctx, 0, out);
      g.gain.setValueAtTime(0.35 * (0.4 + vel * 0.6), t);
      g.gain.setTargetAtTime(0, t, 0.3);
      const a = osc(ctx, t, f);
      a.connect(g);
      const g2 = gain(ctx, 0, out);
      g2.gain.setValueAtTime(0.12 * vel, t);
      g2.gain.setTargetAtTime(0, t, 0.05);
      const b = osc(ctx, t, f * 3.93);
      b.connect(g2);
      return { sources: [a, b], length: 1.4 };
    },
  },
  bell: {
    release: 0.4,
    play(ctx, out, t, f, vel) {
      const g = gain(ctx, 0, out);
      g.gain.setValueAtTime(0.22 * (0.4 + vel * 0.6), t);
      g.gain.setTargetAtTime(0, t, 1.2);
      const car = osc(ctx, t, f);
      car.connect(g);
      const mod = osc(ctx, t, f * 3.5);
      const mg = gain(ctx, 0);
      mg.gain.setValueAtTime(f * 2 * vel, t);
      mg.gain.setTargetAtTime(f * 0.2, t, 0.8);
      mod.connect(mg);
      mg.connect(car.frequency);
      return { sources: [car, mod], length: 4.5 };
    },
  },
};
