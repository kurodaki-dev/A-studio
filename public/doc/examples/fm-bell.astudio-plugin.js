/**
 * @astudio-plugin
 * @id fm-bell
 * @name FM Bell
 * @version 1.0.0
 * @author A Studio
 * @category mallets
 * @param ratio "Ratio" 0.5 8 3.5
 * @param index "Brightness" 0 10 4
 * @param decay "Decay" 0.2 8 2.5
 */

// Two operator FM synthesis: a modulator changes the phase of a carrier.
class FmBell {
  constructor({ frequency, velocity, sampleRate, params }) {
    this.sr = sampleRate;
    this.freq = frequency;
    this.vel = velocity;
    this.pc = 0;
    this.pm = 0;
    this.t = 0;
    this.amp = 0.25 * (0.3 + 0.7 * velocity);
    this.off = false;
    this.ratio = params.ratio;
  }

  noteOff() {
    this.off = true;
  }

  process(left, right, params) {
    const twoPi = 2 * Math.PI;
    const dc = this.freq / this.sr;
    const dm = (this.freq * this.ratio) / this.sr;
    const decay = this.off ? Math.min(params.decay, 0.3) : params.decay;
    for (let i = 0; i < left.length; i++) {
      const time = this.t / this.sr;
      const env = Math.exp(-time / (decay / 4));
      const modEnv = Math.exp(-time / (decay / 8));
      this.pm += dm;
      this.pc += dc;
      if (this.pm > 1) this.pm -= 1;
      if (this.pc > 1) this.pc -= 1;
      const mod = Math.sin(twoPi * this.pm) * params.index * modEnv * this.vel;
      const s = Math.sin(twoPi * this.pc + mod) * env * this.amp;
      left[i] = s;
      right[i] = s;
      this.t++;
    }
    return this.amp * Math.exp(-this.t / this.sr / (decay / 4)) > 0.0005;
  }
}

registerVoice(FmBell);
