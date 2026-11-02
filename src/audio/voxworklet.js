// Vocal processors that run in the audio thread (AudioWorklet): auto tune,
// pitch shifter (voice changer), harmonizer, noise gate and de-esser.
// The code is a string so it can be loaded with addModule from a Blob.
export const VOX_CODE = String.raw`
const SR = sampleRate;
const SCALES = [
  [0,1,2,3,4,5,6,7,8,9,10,11],
  [0,2,4,5,7,9,11],
  [0,2,3,5,7,8,10],
  [0,2,3,5,7,8,11],
  [0,2,4,7,9],
  [0,3,5,7,10],
  [0,3,5,6,7,10],
];

// Delay line pitch shifter: two taps sweep through a short window with a Hann crossfade.
class Shifter {
  constructor() {
    this.N = 8192;
    this.m = this.N - 1;
    this.buf = new Float32Array(this.N);
    this.w = 0;
    this.win = Math.round(SR * 0.035);
    this.phase = 0;
  }
  // Window as a whole number of periods of the input, so each wrap of the
  // delay line lands in phase (no pitch drift, fewer artifacts).
  setPeriod(freq, seconds = 0.035) {
    if (!(freq > 0)) return;
    const period = SR / freq;
    // Even count: the two taps (half a window apart) stay in phase.
    const k = Math.max(2, 2 * Math.round((SR * seconds) / period / 2));
    const w = Math.min(this.N / 2 - 4, Math.round(k * period));
    if (Math.abs(w - this.win) > 1) this.win = w;
  }
  tap(d) {
    let r = this.w - d;
    while (r < 0) r += this.N;
    const i = r | 0;
    const f = r - i;
    const a = this.buf[i & this.m];
    const b = this.buf[(i + 1) & this.m];
    return a + (b - a) * f;
  }
  run(x, ratio) {
    this.buf[this.w] = x;
    this.phase += (1 - ratio) / this.win;
    if (this.phase >= 1) this.phase -= 1;
    else if (this.phase < 0) this.phase += 1;
    const p2 = (this.phase + 0.5) % 1;
    const s1 = Math.sin(Math.PI * this.phase);
    const s2 = Math.sin(Math.PI * p2);
    const y = this.tap(this.phase * this.win + 1) * s1 * s1 + this.tap(p2 * this.win + 1) * s2 * s2;
    this.w = (this.w + 1) & this.m;
    return y;
  }
}

// TD-PSOLA: grains of two periods taken at pitch synchronous points of the input
// and laid out at the new period. The spectral envelope (formants) stays in
// place, so the voice keeps its timbre. Output is delayed by D samples.
class Psola {
  constructor() {
    this.N = 16384;
    this.m = this.N - 1;
    this.inp = new Float32Array(this.N);
    this.out = new Float32Array(this.N);
    this.n = 0;
    this.maxP = Math.ceil(SR / 70);
    this.D = 2 * this.maxP + 256;
    this.next = this.D;
    this.lastC = -1;
    this.hop = 256;
  }
  // Grain of 2 periods around c, added at s. fs > 1 reads the input faster inside the
  // grain, which moves the formants up without changing the pitch (formant shift).
  grain(s, c, P, gain, fs = 1) {
    const m = this.m;
    if (fs === 1) {
      for (let j = -P; j < P; j++) {
        const w = 0.5 - 0.5 * Math.cos((Math.PI * (j + P)) / P);
        this.out[(s + j) & m] += this.inp[(c + j) & m] * w * gain;
      }
      return;
    }
    const G = Math.max(8, Math.round(P / fs));
    const g2 = gain * (P / G);
    for (let j = -G; j < G; j++) {
      const w = 0.5 - 0.5 * Math.cos((Math.PI * (j + G)) / G);
      const r = c + j * fs;
      const i0 = Math.floor(r);
      const f = r - i0;
      const a = this.inp[i0 & m];
      const b = this.inp[(i0 + 1) & m];
      this.out[(s + j) & m] += (a + (b - a) * f) * w * g2;
    }
  }
  // Pitch mark: the highest sample within a quarter period of the predicted point,
  // so every grain is centred on the same part of the vocal cycle.
  mark(c, P) {
    const m = this.m;
    const q = Math.max(1, Math.floor(P / 4));
    let best = c;
    let bv = -Infinity;
    for (let j = c - q; j <= c + q; j++) {
      if (j + P > this.n || j - P < this.n - this.N + 4) continue;
      const v = this.inp[j & m];
      if (v > bv) { bv = v; best = j; }
    }
    return best;
  }
  run(x, ratio, freq, fs = 1) {
    const m = this.m;
    this.inp[this.n & m] = x;
    // Marks are kept as fractions: rounding the period or the spacing to whole
    // samples would put the output pitch a few cents off.
    while (this.next <= this.n - this.maxP) {
      const s0 = Math.round(this.next);
      if (freq > 0 && freq < 1000) {
        const Pf = Math.max(16, Math.min(this.maxP, SR / freq));
        const P = Math.round(Pf);
        // Pitch synchronous analysis point near the synthesis point.
        let c = this.lastC < 0 ? s0 : Math.round(this.lastC + Math.round((s0 - this.lastC) / Pf) * Pf);
        if (c + P > this.n || c - P < this.n - this.N + 4) c = s0;
        c = this.mark(c, P);
        const Pout = Math.max(8, Pf / ratio);
        this.grain(s0, c, P, Pout / P, fs);
        this.lastC = c;
        this.next += Pout;
      } else {
        const P = this.hop;
        this.grain(s0, s0, P, 1);
        this.lastC = -1;
        this.next = s0 + P;
      }
    }
    const k = (this.n - this.D) & m;
    const y = this.n >= this.D ? this.out[k] : 0;
    this.out[k] = 0;
    this.n++;
    return y;
  }
}

// Stereo delay for the dry signal, so it stays aligned with the PSOLA output.
class DryDelay {
  constructor(n) {
    this.n = n;
    this.b = [new Float32Array(n), new Float32Array(n)];
    this.i = 0;
  }
  // Writes the current samples and returns the ones from n samples ago.
  run(l, r) {
    const i = this.i;
    const ol = this.b[0][i];
    const or = this.b[1][i];
    this.b[0][i] = l;
    this.b[1][i] = r;
    this.i = (i + 1) % this.n;
    return [ol, or];
  }
}

// YIN pitch detector on a 2x decimated signal. Returns Hz, or 0 when unvoiced.
class Detector {
  constructor() {
    this.sr = SR / 2;
    this.size = 1024;
    this.ring = new Float32Array(this.size);
    this.pos = 0;
    this.half = 0;
    this.hasHalf = false;
    this.count = 0;
    this.hop = 256;
    this.win = 512;
    this.minTau = Math.floor(this.sr / 1000);
    this.maxTau = Math.min(this.size - this.win - 2, Math.floor(this.sr / 70));
    this.d = new Float32Array(this.maxTau + 2);
    this.lin = new Float32Array(this.size);
    this.freq = 0;
  }
  push(x) {
    if (!this.hasHalf) {
      this.half = x;
      this.hasHalf = true;
      return false;
    }
    this.hasHalf = false;
    this.ring[this.pos] = (this.half + x) * 0.5;
    this.pos = (this.pos + 1) % this.size;
    if (++this.count >= this.hop) {
      this.count = 0;
      this.detect();
      return true;
    }
    return false;
  }
  detect() {
    const s = this.lin;
    for (let i = 0; i < this.size; i++) s[i] = this.ring[(this.pos + i) % this.size];
    const off = this.size - this.win - this.maxTau - 1;
    let energy = 0;
    for (let j = 0; j < this.win; j++) energy += s[off + j] * s[off + j];
    if (energy / this.win < 1e-5) {
      this.freq = 0;
      return;
    }
    const d = this.d;
    d[0] = 1;
    let sum = 0;
    let tau = -1;
    for (let t = 1; t <= this.maxTau; t++) {
      let acc = 0;
      for (let j = 0; j < this.win; j++) {
        const v = s[off + j] - s[off + j + t];
        acc += v * v;
      }
      sum += acc;
      d[t] = sum > 0 ? (acc * t) / sum : 1;
    }
    // First dip under the threshold that is close to the deepest one: avoids the
    // small dips made by strong formants and octave errors on later periods.
    let gmin = 1;
    for (let t = this.minTau; t < this.maxTau; t++) gmin = Math.min(gmin, d[t]);
    if (gmin < 0.15) {
      const ok = gmin * 1.5 + 0.02;
      for (let t = this.minTau; t < this.maxTau; t++) {
        if (d[t] <= ok) {
          while (t + 1 < this.maxTau && d[t + 1] < d[t]) t++;
          tau = t;
          break;
        }
      }
    }
    if (tau < 0) {
      this.freq = 0;
      return;
    }
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const den = a + c - 2 * b;
    const t2 = den !== 0 ? tau + (a - c) / (2 * den) : tau;
    this.freq = this.sr / t2;
  }
}

class Base extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    this.p = (opts.processorOptions && opts.processorOptions.params) || {};
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'params') this.p = e.data.values;
    };
  }
}

// Auto tune. Detection is smoothed (median of the last detections, octave errors
// folded back), the target note changes only when the voice clearly reaches another
// note (no warble), Flex lets notes far from the target through, the natural
// vibrato can be kept, and in MIDI mode the target comes from a channel's notes.
const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
class Tune extends Base {
  constructor(opts) {
    super(opts);
    this.det = new Detector();
    this.sh = new Shifter();
    this.ps = new Psola();
    this.dd = new DryDelay(this.ps.D);
    this.ratio = 1;
    this.goal = 1;
    this.hist = [];
    this.mSlow = 0;
    this.note = null;
    this.voiced = 0;
    this.targets = [];
    this.vphase = 0;
    this.post = 0;
    this.inM = 0;
    this.outM = 0;
    const base = this.port.onmessage;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d && d.type === 'target') {
        this.targets.push({ key: d.key, from: d.from, to: d.to });
        if (this.targets.length > 256) this.targets.splice(0, this.targets.length - 256);
      } else if (d && d.type === 'clearTargets') this.targets = [];
      else base(e);
    };
  }
  nearest(m) {
    const key = Math.round(this.p.key || 0);
    const scale = SCALES[Math.round(this.p.scale || 0)] || SCALES[0];
    let best = Math.round(m);
    let bd = 99;
    for (let o = -1; o <= 1; o++) {
      const base = Math.floor(m / 12) * 12 + o * 12;
      for (const st of scale) {
        const n = base + ((st + key) % 12);
        const dd = Math.abs(n - m);
        if (dd < bd) { bd = dd; best = n; }
      }
    }
    return best;
  }
  // MIDI mode: the note of the source channel sounding at this frame (latest started).
  midiTarget(frame) {
    const shift = this.lowLatency() || !this.keepFormants() ? 0 : this.ps.D;
    let best = null;
    for (const t of this.targets) {
      if (t.from - shift <= frame && frame < t.to - shift && (!best || t.from > best.from)) best = t;
    }
    if (this.targets.length && frame - SR > this.targets[0].to) this.targets = this.targets.filter((t) => t.to > frame - SR);
    return best ? best.key : null;
  }
  keepFormants() {
    return this.p.formant == null ? 1 : this.p.formant;
  }
  lowLatency() {
    return !!this.p.lowLatency;
  }
  analyse(frame) {
    const f = this.det.freq;
    const hopSec = (this.det.hop * 2) / SR;
    if (!(f > 0)) {
      // Short gaps (consonants) keep the last correction for a few hops.
      if (this.voiced > 0) this.voiced--;
      if (this.voiced === 0) {
        this.goal = 1;
        this.note = null;
        this.hist = [];
        this.inM = 0;
        this.armed = false;
      }
      return;
    }
    this.lastF = f;
    // First detection after silence: the analysis window still holds part of the
    // silence, so it is dropped.
    if (this.voiced === 0 && !this.armed) {
      this.armed = true;
      return;
    }
    let m = 69 + 12 * Math.log2(f / 440);
    if (this.hist.length) {
      const med = median(this.hist);
      if (Math.abs(m - med - 12) < 1.2) m -= 12;
      else if (Math.abs(m - med + 12) < 1.2) m += 12;
    }
    this.hist.push(m);
    if (this.hist.length > 5) this.hist.shift();
    const mm = median(this.hist);
    const onset = this.voiced === 0;
    this.voiced = 4;
    // The very first detection of a note is the least reliable: wait for a second one.
    if (this.hist.length < 2) {
      this.goal = 1;
      this.inM = 0;
      this.mSlow = mm;
      return;
    }
    this.mSlow = onset || this.hist.length < 4 ? mm : this.mSlow + (mm - this.mSlow) * (1 - Math.exp(-hopSec / 0.12));
    const midi = Math.round(this.p.mode || 0) === 1 ? this.midiTarget(frame) : null;
    let note;
    if (midi != null) note = midi;
    else {
      const cand = this.nearest(this.mSlow);
      // Hysteresis: switch only when the voice is clearly closer to the new note.
      // The first detections of a note are less precise, so no hysteresis yet.
      if (this.note == null || this.hist.length < 4 || Math.abs(this.mSlow - cand) + 0.18 < Math.abs(this.mSlow - this.note)) note = cand;
      else note = this.note;
    }
    this.note = note;
    let amount = 1;
    const flex = this.p.flex || 0;
    if (flex > 0 && midi == null) {
      const dev = Math.abs(this.mSlow - note) * 100;
      const W = 60 * (1 - flex) + 8;
      amount = dev <= W ? 1 : Math.max(0, 1 - (dev - W) / 25);
    }
    const keepVib = this.p.vibrato || 0;
    const want = note + keepVib * (m - this.mSlow);
    const outM = m + amount * (want - m);
    this.goal = Math.pow(2, (outM - m) / 12);
    if (onset || this.hist.length === 2) this.ratio = this.goal;
    this.inM = m;
    this.outM = outM;
    if (this.lowLatency()) this.sh.setPeriod(f, 0.012);
    else this.sh.setPeriod(f);
  }
  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const L = inp && inp[0];
    const R = inp && (inp[1] || inp[0]);
    const n = out[0].length;
    const mix = this.p.mix == null ? 1 : this.p.mix;
    const retune = Math.max(0, this.p.retune || 0);
    const ks = retune <= 1 ? 1 : 1 - Math.exp(-1 / ((SR * retune) / 1000));
    const keep = this.keepFormants() && !this.lowLatency();
    const fs = keep ? Math.pow(2, (this.p.formantShift || 0) * 0.5) : 1;
    const depth = this.p.vibDepth || 0;
    const rate = this.p.vibRate || 5.5;
    for (let i = 0; i < n; i++) {
      const x = L ? (L[i] + R[i]) * 0.5 : 0;
      if (this.det.push(x)) this.analyse(currentFrame + i);
      this.ratio += (this.goal - this.ratio) * ks;
      let r = this.ratio;
      if (depth > 0 && this.voiced > 0) {
        this.vphase += (2 * Math.PI * rate) / SR;
        if (this.vphase > 2 * Math.PI) this.vphase -= 2 * Math.PI;
        r *= Math.pow(2, (depth * Math.sin(this.vphase)) / 1200);
      }
      const y = keep ? this.ps.run(x, r, this.voiced > 0 ? this.det.freq || this.lastF || 0 : 0, fs) : this.sh.run(x, r);
      const dl = inp && inp[0] ? inp[0][i] : x;
      const dr = inp && inp[1] ? inp[1][i] : dl;
      const d = this.dd.run(dl, dr);
      for (let c = 0; c < out.length; c++) {
        const dry = keep ? d[c ? 1 : 0] : c ? dr : dl;
        out[c][i] = dry * (1 - mix) + y * mix;
      }
    }
    // Pitch graph data for the FX window, about 25 times per second.
    this.post += n;
    if (this.post >= SR / 25) {
      this.post = 0;
      const on = this.voiced > 0 && this.inM > 0;
      this.port.postMessage({ type: 'pitch', input: on ? this.inM : null, output: on ? this.outM : null, note: this.note });
    }
    return true;
  }
}

class Shift extends Base {
  constructor(opts) {
    super(opts);
    this.sh = new Shifter();
    this.det = new Detector();
    this.ps = new Psola();
    this.dd = new DryDelay(this.ps.D);
    this.lp = 0;
  }
  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const L = inp && inp[0];
    const R = inp && (inp[1] || inp[0]);
    const ratio = Math.pow(2, (this.p.semitones || 0) / 12);
    const tone = this.p.tone || 0;
    const mix = this.p.mix == null ? 1 : this.p.mix;
    for (let i = 0; i < out[0].length; i++) {
      const x = L ? (L[i] + R[i]) * 0.5 : 0;
      if (this.det.push(x)) this.sh.setPeriod(this.det.freq);
      let y = this.p.formant ? this.ps.run(x, ratio, this.det.freq) : this.sh.run(x, ratio);
      // Tone: negative darkens (low pass), positive brightens (adds the high part).
      this.lp += (y - this.lp) * 0.18;
      y = tone < 0 ? y + (this.lp - y) * -tone : y + (y - this.lp) * tone;
      const dl = inp && inp[0] ? inp[0][i] : x;
      const dr = inp && inp[1] ? inp[1][i] : dl;
      const d = this.dd.run(dl, dr);
      for (let c = 0; c < out.length; c++) {
        const dry = this.p.formant ? d[c ? 1 : 0] : c ? dr : dl;
        out[c][i] = dry * (1 - mix) + y * mix;
      }
    }
    return true;
  }
}

class Harmony extends Base {
  constructor(opts) {
    super(opts);
    this.a = new Shifter();
    this.b = new Shifter();
    this.det = new Detector();
  }
  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const L = inp && inp[0];
    const R = inp && (inp[1] || inp[0]);
    const ra = Math.pow(2, (this.p.voiceA || 0) / 12);
    const rb = Math.pow(2, (this.p.voiceB || 0) / 12);
    const lv = this.p.level == null ? 0.5 : this.p.level;
    for (let i = 0; i < out[0].length; i++) {
      const x = L ? (L[i] + R[i]) * 0.5 : 0;
      if (this.det.push(x)) {
        this.a.setPeriod(this.det.freq);
        this.b.setPeriod(this.det.freq);
      }
      const ya = this.a.run(x, ra) * lv;
      const yb = this.p.voiceB ? this.b.run(x, rb) * lv : 0;
      const dl = inp && inp[0] ? inp[0][i] : x;
      const dr = inp && inp[1] ? inp[1][i] : dl;
      out[0][i] = dl + ya * 0.8 + yb * 0.4;
      if (out[1]) out[1][i] = dr + ya * 0.4 + yb * 0.8;
    }
    return true;
  }
}

class Gate extends Base {
  constructor(opts) {
    super(opts);
    this.env = 0;
    this.g = 0;
    this.hold = 0;
  }
  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const th = Math.pow(10, (this.p.threshold == null ? -45 : this.p.threshold) / 20);
    const rel = Math.exp(-1 / (SR * Math.max(5, this.p.release || 120) / 1000));
    const att = Math.exp(-1 / (SR * 0.001));
    for (let i = 0; i < out[0].length; i++) {
      let peak = 0;
      if (inp) for (const ch of inp) peak = Math.max(peak, Math.abs(ch[i]));
      this.env = Math.max(peak, this.env * 0.9995);
      if (this.env > th) this.hold = SR * 0.02;
      const open = this.hold-- > 0 ? 1 : 0;
      this.g = open ? 1 - (1 - this.g) * att : this.g * rel;
      for (let c = 0; c < out.length; c++) out[c][i] = inp && inp[c] ? inp[c][i] * this.g : 0;
    }
    return true;
  }
}

class Deess extends Base {
  constructor(opts) {
    super(opts);
    this.s = [];
    this.env = 0;
    this.gain = 1;
  }
  coef() {
    const f = Math.min(SR * 0.45, this.p.freq || 6000);
    const w = 2 * Math.PI * f / SR;
    const q = 0.707;
    const al = Math.sin(w) / (2 * q);
    const cw = Math.cos(w);
    const a0 = 1 + al;
    return { b0: (1 + cw) / 2 / a0, b1: -(1 + cw) / a0, b2: (1 + cw) / 2 / a0, a1: -2 * cw / a0, a2: (1 - al) / a0 };
  }
  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const k = this.coef();
    const th = Math.pow(10, (this.p.threshold == null ? -30 : this.p.threshold) / 20);
    const amount = this.p.amount == null ? 0.7 : this.p.amount;
    for (let c = 0; c < out.length; c++) if (!this.s[c]) this.s[c] = { x1: 0, x2: 0, y1: 0, y2: 0 };
    for (let i = 0; i < out[0].length; i++) {
      let hiPeak = 0;
      const hs = [];
      for (let c = 0; c < out.length; c++) {
        const x = inp && inp[c] ? inp[c][i] : 0;
        const s = this.s[c];
        const y = k.b0 * x + k.b1 * s.x1 + k.b2 * s.x2 - k.a1 * s.y1 - k.a2 * s.y2;
        s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y;
        hs.push(y);
        hiPeak = Math.max(hiPeak, Math.abs(y));
      }
      this.env = Math.max(hiPeak, this.env * 0.999);
      const want = this.env > th ? 1 - amount * (1 - th / this.env) : 1;
      this.gain += (want - this.gain) * (want < this.gain ? 0.02 : 0.002);
      // Broadband reduction while the sibilant band is over the threshold.
      for (let c = 0; c < out.length; c++) out[c][i] = (inp && inp[c] ? inp[c][i] : 0) * this.gain;
    }
    return true;
  }
}

registerProcessor('astudio-vox-tune', Tune);
registerProcessor('astudio-vox-shift', Shift);
registerProcessor('astudio-vox-harmony', Harmony);
registerProcessor('astudio-vox-gate', Gate);
registerProcessor('astudio-vox-deess', Deess);
`;

// Load the module once per audio context.
const loaded = new WeakMap();
export function loadVox(ctx) {
  if (loaded.has(ctx)) return loaded.get(ctx).promise;
  const url = URL.createObjectURL(new Blob([VOX_CODE], { type: 'text/javascript' }));
  const entry = { ready: false };
  entry.promise = ctx.audioWorklet
    .addModule(url)
    .then(() => {
      entry.ready = true;
      return true;
    })
    .catch(() => false)
    .finally(() => URL.revokeObjectURL(url));
  loaded.set(ctx, entry);
  return entry.promise;
}
export const voxReady = (ctx) => !!(loaded.get(ctx) && loaded.get(ctx).ready);
