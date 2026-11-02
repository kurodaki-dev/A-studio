// Fader position to linear gain. 0.8 is 0 dB, like FL Studio's mixer.
export const faderGain = (v) => (v <= 0 ? 0 : Math.pow(v / 0.8, 2));
export const cutoffHz = (v) => 40 * Math.pow(20000 / 40, v);
