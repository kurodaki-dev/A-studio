/**
 * @astudio-plugin
 * @id poly-synth
 * @name Poly Synth
 * @version 1.0.0
 * @author A Studio
 * @category synth
 * @choice wave "Wave" saw|square|triangle|sine 0
 * @param cutoff "Cutoff" 80 12000 2500
 * @param reso "Resonance" 0 0.95 0.3
 * @param attack "Attack" 0.001 2 0.01
 * @param release "Release" 0.01 4 0.4
 * @toggle sub "Sub osc" 1
 * @button drift "New drift"
 */

// One oscillator plus an optional sub oscillator, a resonant state variable
// filter, an attack and release envelope, and a random pitch drift that the
// "New drift" button changes on every playing note.
function wave(kind, p) {
  if (kind === 0) return 2 * p - 1;
  if (kind === 1) return p < 0.5 ? 1 : -1;
  if (kind === 2) return 1 - 4 * Math.abs(p - 0.5);
  return Math.sin(2 * Math.PI * p);
}

class PolyVoice {
  constructor({ frequency, velocity, sampleRate }) {
    this.sr = sampleRate;
    this.freq = frequency;
    this.amp = 0.16 * (0.3 + 0.7 * velocity);
    this.p1 = Math.random();
    this.p2 = Math.random();
    this.low = 0;
    this.band = 0;
    this.env = 0;
    this.off = false;
    this.drift = 1 + (Math.random() - 0.5) * 0.006;
  }

  noteOff() {
    this.off = true;
  }

  button(id) {
    if (id === 'drift') this.drift = 1 + (Math.random() - 0.5) * 0.02;
  }

  process(left, right, params) {
    const f = Math.min(0.99, 2 * Math.sin((Math.PI * Math.min(params.cutoff, this.sr / 6)) / this.sr));
    const q = 1 - params.reso;
    const up = 1 / Math.max(1, params.attack * this.sr);
    const down = Math.exp(-1 / (params.release * this.sr));
    const inc = (this.freq * this.drift) / this.sr;
    for (let i = 0; i < left.length; i++) {
      this.p1 = (this.p1 + inc) % 1;
      this.p2 = (this.p2 + inc / 2) % 1;
      let x = wave(params.wave, this.p1);
      if (params.sub) x = x * 0.7 + Math.sin(2 * Math.PI * this.p2) * 0.5;
      this.low += f * this.band;
      const high = x - this.low - q * this.band;
      this.band += f * high;
      this.env = this.off ? this.env * down : Math.min(1, this.env + up);
      const s = this.low * this.env * this.amp;
      left[i] = s;
      right[i] = s;
    }
    return !(this.off && this.env < 0.0003);
  }
}

registerVoice(PolyVoice);
