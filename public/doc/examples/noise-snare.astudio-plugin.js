/**
 * @astudio-plugin
 * @id noise-snare
 * @name Noise Snare
 * @version 1.0.0
 * @author A Studio
 * @category drums
 * @oneshot
 * @param tone "Tone" 100 400 190
 * @param snap "Snap" 0 1 0.6
 * @param length "Length" 0.05 0.6 0.2
 */

// A drum voice ignores note length: it plays its whole sound, then returns false.
class NoiseSnare {
  constructor({ velocity, sampleRate, frequency, params }) {
    this.sr = sampleRate;
    this.vel = velocity;
    this.pitch = frequency / 261.63; // C5 plays the sound at its base tone
    this.t = 0;
    this.phase = 0;
    this.hp = 0;
    this.last = 0;
  }

  process(left, right, params) {
    const len = params.length * this.sr;
    const tone = params.tone * this.pitch;
    for (let i = 0; i < left.length; i++) {
      const x = this.t / len;
      if (x >= 1) {
        left[i] = 0;
        right[i] = 0;
        this.t++;
        continue;
      }
      const noise = Math.random() * 2 - 1;
      // simple high pass on the noise for the snare wires
      this.hp = 0.6 * (this.hp + noise - this.last);
      this.last = noise;
      this.phase += (tone * (1 - 0.3 * x)) / this.sr;
      const body = Math.sin(2 * Math.PI * this.phase) * Math.exp(-x * 8);
      const wires = this.hp * Math.exp(-x * 4) * params.snap;
      const s = (body * 0.6 + wires * 0.7) * this.vel * 0.5;
      left[i] = s;
      right[i] = s;
      this.t++;
    }
    return this.t < len;
  }
}

registerVoice(NoiseSnare);
