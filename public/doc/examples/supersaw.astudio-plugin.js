/**
 * @astudio-plugin
 * @id supersaw
 * @name Supersaw
 * @version 1.0.0
 * @author A Studio
 * @category synth
 * @param detune "Detune" 0 1 0.35
 * @param cutoff "Cutoff" 200 12000 4000
 * @param release "Release" 0.01 3 0.4
 */

// Seven detuned sawtooth oscillators, a one pole low pass filter per side
// and an attack/release envelope.
const SPREAD = [-1, -0.66, -0.33, 0, 0.33, 0.66, 1];

class Supersaw {
  constructor({ frequency, velocity, sampleRate, params }) {
    this.sr = sampleRate;
    this.freq = frequency;
    this.gain = 0.08 * (0.3 + 0.7 * velocity);
    this.phases = SPREAD.map(() => Math.random());
    this.env = 0;
    this.releasing = false;
    this.zL = 0;
    this.zR = 0;
    this.params = params;
  }

  noteOff() {
    this.releasing = true;
  }

  // Fill left and right with samples. Return false when the voice is silent.
  process(left, right, params) {
    const cents = params.detune * 40;
    const rates = SPREAD.map((s) => (this.freq * Math.pow(2, (s * cents) / 1200)) / this.sr);
    const a = 1 - Math.exp((-2 * Math.PI * params.cutoff) / this.sr);
    const attack = 1 / (0.01 * this.sr);
    const release = 1 / (params.release * this.sr);
    for (let i = 0; i < left.length; i++) {
      let l = 0;
      let r = 0;
      for (let o = 0; o < rates.length; o++) {
        let ph = this.phases[o] + rates[o];
        if (ph >= 1) ph -= 1;
        this.phases[o] = ph;
        const saw = 2 * ph - 1;
        if (o % 2) l += saw;
        else r += saw;
        if (o === 3) { l += saw * 0.5; r += saw * 0.5; }
      }
      this.env = this.releasing ? Math.max(0, this.env - release) : Math.min(1, this.env + attack);
      this.zL += a * (l - this.zL);
      this.zR += a * (r - this.zR);
      left[i] = this.zL * this.env * this.gain;
      right[i] = this.zR * this.env * this.gain;
    }
    return !(this.releasing && this.env === 0);
  }
}

registerVoice(Supersaw);
