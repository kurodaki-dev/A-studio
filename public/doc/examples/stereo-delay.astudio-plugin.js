/**
 * @astudio-plugin
 * @id stereo-delay
 * @name Stereo Delay
 * @version 1.0.0
 * @author A Studio
 * @type effect
 * @param time "Time ms" 20 1500 350
 * @param feedback "Feedback" 0 0.95 0.45
 * @param tone "Tone" 500 12000 4000
 * @param mix "Mix" 0 1 0.35
 * @toggle pingpong "Ping pong" 1
 * @button clear "Clear"
 */

// A delay line per side with feedback, a low pass in the loop and an
// optional ping pong mode where echoes bounce between left and right.
class StereoDelay {
  constructor({ sampleRate }) {
    this.sr = sampleRate;
    this.size = Math.ceil(sampleRate * 1.6);
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

  process(inL, inR, outL, outR, params) {
    const d = Math.min(this.size - 1, Math.max(1, Math.round((params.time / 1000) * this.sr)));
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
