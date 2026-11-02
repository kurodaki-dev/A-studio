// Helpers available to instrument and effect plugins as the global `dsp`.
// The code is injected before the plugin code in the AudioWorklet module.
export const DSP_LIB = String.raw`const dsp = (() => {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  // PolyBLEP correction for band limited saw and square waves.
  const blep = (t, dt) => {
    if (t < dt) { t /= dt; return t + t - t * t - 1; }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
    return 0;
  };
  class Osc {
    constructor(sr) { this.sr = sr; this.phase = 0; this.tri = 0; }
    step(f) { const dt = f / this.sr; this.phase += dt; if (this.phase >= 1) this.phase -= 1; return dt; }
    sine(f) { this.step(f); return Math.sin(TAU * this.phase); }
    saw(f) { const dt = this.step(f); return 2 * this.phase - 1 - blep(this.phase, dt); }
    square(f, pw = 0.5) {
      const dt = this.step(f);
      let s = this.phase < pw ? 1 : -1;
      s += blep(this.phase, dt);
      s -= blep((this.phase + 1 - pw) % 1, dt);
      return s;
    }
    triangle(f) {
      const dt = f / this.sr;
      const sq = this.square(f);
      this.tri = dt * sq * 4 + (1 - dt * 0.5) * this.tri;
      return clamp(this.tri, -1, 1);
    }
  }
  class Noise {
    constructor(seed = 22222) { this.s = seed >>> 0 || 1; this.b = [0, 0, 0]; }
    white() { this.s ^= this.s << 13; this.s ^= this.s >>> 17; this.s ^= this.s << 5; return ((this.s >>> 0) / 4294967296) * 2 - 1; }
    pink() {
      const w = this.white();
      const b = this.b;
      b[0] = 0.99765 * b[0] + w * 0.099046;
      b[1] = 0.963 * b[1] + w * 0.2965164;
      b[2] = 0.57 * b[2] + w * 1.0526913;
      return (b[0] + b[1] + b[2] + w * 0.1848) * 0.25;
    }
  }
  // ADSR envelope. Times in seconds, sustain 0..1. gate(true) starts, gate(false) releases.
  class Env {
    constructor(sr, { attack = 0.005, decay = 0.1, sustain = 0.8, release = 0.2 } = {}) {
      this.sr = sr; this.set({ attack, decay, sustain, release }); this.v = 0; this.stage = 0;
    }
    set({ attack, decay, sustain, release }) {
      if (attack != null) this.a = Math.max(1e-4, attack);
      if (decay != null) this.d = Math.max(1e-4, decay);
      if (sustain != null) this.s = clamp(sustain, 0, 1);
      if (release != null) this.r = Math.max(1e-4, release);
    }
    gate(on) { this.stage = on ? 1 : 4; }
    get done() { return this.stage === 0 || (this.stage === 4 && this.v < 1e-4); }
    next() {
      const sr = this.sr;
      if (this.stage === 1) { this.v += 1 / (this.a * sr); if (this.v >= 1) { this.v = 1; this.stage = 2; } }
      else if (this.stage === 2) { this.v += (this.s - this.v) * (1 - Math.exp(-4 / (this.d * sr))); if (Math.abs(this.v - this.s) < 1e-4) this.stage = 3; }
      else if (this.stage === 4) { this.v *= Math.exp(-6.9 / (this.r * sr)); if (this.v < 1e-5) { this.v = 0; this.stage = 0; } }
      return this.v;
    }
  }
  // Biquad filter (RBJ cookbook): 'lowpass', 'highpass', 'bandpass', 'notch', 'peak', 'lowshelf', 'highshelf'.
  class Biquad {
    constructor(sr) { this.sr = sr; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set('lowpass', 1000, 0.707, 0); }
    set(type, freq, q = 0.707, gainDb = 0) {
      const w = TAU * clamp(freq, 10, this.sr * 0.49) / this.sr;
      const cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * Math.max(0.05, q)), A = Math.pow(10, gainDb / 40);
      let b0, b1, b2, a0, a1, a2;
      if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
      else if (type === 'bandpass') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
      else if (type === 'notch') { b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
      else if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
      else if (type === 'lowshelf' || type === 'highshelf') {
        const s = type === 'lowshelf' ? 1 : -1, r = 2 * Math.sqrt(A) * al;
        b0 = A * ((A + 1) - s * (A - 1) * cw + r); b1 = 2 * s * A * ((A - 1) - s * (A + 1) * cw); b2 = A * ((A + 1) - s * (A - 1) * cw - r);
        a0 = (A + 1) + s * (A - 1) * cw + r; a1 = -2 * s * ((A - 1) + s * (A + 1) * cw); a2 = (A + 1) + s * (A - 1) * cw - r;
      } else { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
      this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
      return this;
    }
    process(x) {
      const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
      return y;
    }
  }
  // Smooths a control value over 'ms' milliseconds (avoids clicks when a knob moves).
  class Smooth {
    constructor(sr, ms = 20, v = 0) { this.k = 1 - Math.exp(-1 / (sr * ms / 1000)); this.v = v; }
    next(target) { this.v += (target - this.v) * this.k; return this.v; }
  }
  // Delay line with interpolated reads, up to maxSeconds.
  class Delay {
    constructor(sr, maxSeconds = 2) { this.sr = sr; this.n = Math.ceil(sr * maxSeconds) + 2; this.b = new Float32Array(this.n); this.w = 0; }
    write(x) { this.b[this.w] = x; this.w = (this.w + 1) % this.n; }
    read(seconds) {
      const d = clamp(seconds * this.sr, 1, this.n - 2);
      let r = this.w - d; if (r < 0) r += this.n;
      const i = Math.floor(r), f = r - i, a = this.b[i], b = this.b[(i + 1) % this.n];
      return a + (b - a) * f;
    }
  }
  return {
    TAU, clamp,
    lerp: (a, b, t) => a + (b - a) * t,
    mtof: (m) => 440 * Math.pow(2, (m - 69) / 12),
    dbToGain: (db) => Math.pow(10, db / 20),
    gainToDb: (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity),
    softClip: (x) => Math.tanh(x),
    Osc, Noise, Env, Biquad, Smooth, Delay,
  };
})();
`;

// Lines added before the plugin code in the generated module, so errors can be
// reported with the line number of the plugin file.
export const DSP_LIB_LINES = DSP_LIB.split('\n').length - 1;
