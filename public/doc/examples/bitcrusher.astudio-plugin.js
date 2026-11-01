/**
 * @astudio-plugin
 * @id bitcrusher
 * @name Bitcrusher
 * @version 1.0.0
 * @author A Studio
 * @type effect
 * @param bits "Bits" 1 16 6
 * @param rate "Downsample" 1 40 6
 * @param mix "Mix" 0 1 0.8
 */

// Lowers the resolution (bits) and the sample rate (downsample) of the sound.
class Bitcrusher {
  constructor() {
    this.count = 0;
    this.holdL = 0;
    this.holdR = 0;
  }

  process(inL, inR, outL, outR, params) {
    const levels = Math.pow(2, params.bits) / 2;
    const step = Math.max(1, Math.round(params.rate));
    for (let i = 0; i < inL.length; i++) {
      if (this.count++ % step === 0) {
        this.holdL = Math.round(inL[i] * levels) / levels;
        this.holdR = Math.round(inR[i] * levels) / levels;
      }
      outL[i] = inL[i] * (1 - params.mix) + this.holdL * params.mix;
      outR[i] = inR[i] * (1 - params.mix) + this.holdR * params.mix;
    }
  }
}

registerEffect(Bitcrusher);
