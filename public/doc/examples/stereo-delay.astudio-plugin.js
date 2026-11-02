/**
 * @astudio-plugin
 * @id stereo-delay
 * @name Stereo Delay
 * @version 1.1.0
 * @author A Studio
 * @type effect
 * @toggle sync "Tempo sync" 1
 * @choice division "Division" 1/2|1/4|1/4 dotted|1/8|1/8 dotted|1/16 3
 * @param time "Time ms" 20 1500 350
 * @param feedback "Feedback" 0 0.95 0.45
 * @param tone "Tone" 500 12000 4000
 * @param mix "Mix" 0 1 0.35
 * @toggle pingpong "Ping pong" 1
 * @button clear "Clear"
 * @preset "Slapback" sync=0 time=90 feedback=0.1 tone=6000 mix=0.3 pingpong=0
 * @preset "Dotted eighth" sync=1 division=4 feedback=0.45 tone=4000 mix=0.35 pingpong=1
 * @preset "Dub" sync=1 division=2 feedback=0.75 tone=1500 mix=0.45 pingpong=1
 */

// A delay line per side with feedback, a low pass in the loop and an
// optional ping pong mode where echoes bounce between left and right.
// With Tempo sync on, the delay time follows the project tempo
// (transport.bpm) and the chosen note division.
const DIVISIONS = [2, 1, 1.5, 0.5, 0.75, 0.25]; // in beats
class StereoDelay {
  constructor({ sampleRate }) {
    this.sr = sampleRate;
    this.size = Math.ceil(sampleRate * 4);
    this.bufL = new Float32Array(this.size);
    this.bufR = new Float32Array(this.size);
    this.pos = 0;
    this.lpL = 0;
    this.lpR = 0;
  }

  // Called when the Clear button is pressed.
  button(id) {
    if (id === 'clear') {
      this.bufL.fill(0);
      this.bufR.fill(0);
    }
  }

  process(inL, inR, outL, outR, params, transport) {
    const seconds = params.sync ? (60 / transport.bpm) * DIVISIONS[params.division] : params.time / 1000;
    const d = Math.min(this.size - 1, Math.max(1, Math.round(seconds * this.sr)));
    const a = 1 - Math.exp((-2 * Math.PI * params.tone) / this.sr);
    for (let i = 0; i < inL.length; i++) {
      const read = (this.pos - d + this.size) % this.size;
      const dl = this.bufL[read];
      const dr = this.bufR[read];
      this.lpL += a * (dl - this.lpL);
      this.lpR += a * (dr - this.lpR);
      if (params.pingpong) {
        this.bufL[this.pos] = (inL[i] + inR[i]) * 0.5 + this.lpR * params.feedback;
        this.bufR[this.pos] = this.lpL * params.feedback;
      } else {
        this.bufL[this.pos] = inL[i] + this.lpL * params.feedback;
        this.bufR[this.pos] = inR[i] + this.lpR * params.feedback;
      }
      this.pos = (this.pos + 1) % this.size;
      outL[i] = inL[i] + dl * params.mix;
      outR[i] = inR[i] + dr * params.mix;
    }
  }
}

registerEffect(StereoDelay);
