// Humanizer for UTAU voices (optional, off by default): gives the flat pitch of
// concatenated recordings the small moves of a real singer.
//
// Two choices:
// - "Built-in" (light, offline, no download): rules measured on sung pitch curves:
//   overshoot after a jump, a dip before a rise, slow drift, a little vibrato on long
//   notes and a fall at the end of a phrase. It is not a neural network.
// - An imported ONNX model (local, nothing is sent anywhere). Interface: input "f0"
//   float32 [1, T] (pitch in MIDI notes, 100 frames per second), output [1, T] (the
//   humanized pitch). The difference is added to the curve.

export const HUMANIZER_FPS = 100;

// Deterministic noise from a seed: sum of slow sines (1/f like).
function drift(seed) {
  const parts = [0.31, 0.53, 0.97, 1.7, 2.9].map((f, i) => ({ f, a: 0.05 / (i + 1), p: ((seed * (i + 7) * 9301 + 49297) % 233280) / 233280 * 6.283 }));
  return (t) => parts.reduce((s, x) => s + x.a * Math.sin(6.283 * x.f * t + x.p), 0);
}

// Built-in humanizer: fn(t, notes, i) -> semitones to add at time t (note index i).
export function builtinHumanizer(seed = 1, amount = 1) {
  const d = drift(seed);
  return (t, notes, i) => {
    const n = notes[i];
    if (!n) return 0;
    let dev = d(t) * amount;
    const prev = notes[i - 1];
    const next = notes[i + 1];
    const since = t - n.start;
    if (prev && n.start - prev.end < 0.05 && since >= 0) {
      const jump = n.key - prev.key;
      if (Math.abs(jump) >= 1) {
        // Overshoot then settle (about 120 ms).
        dev += Math.sign(jump) * Math.min(0.6, 0.12 * Math.abs(jump)) * Math.exp(-since / 0.05) * Math.cos(since * 25) * amount;
      }
    }
    if (next && next.start - n.end < 0.05 && next.key > n.key) {
      // Small dip just before rising to the next note.
      const to = next.start - t;
      if (to > 0 && to < 0.08) dev -= 0.15 * (1 - to / 0.08) * amount;
    }
    const len = n.end - n.start;
    if (len > 0.6 && (!n.vib || !n.vib.depth) && since > len * 0.55 && t < n.end) {
      const x = since - len * 0.55;
      dev += 0.25 * Math.min(1, x / 0.25) * Math.sin(6.283 * 5.6 * x) * amount;
    }
    if (!next || next.start - n.end > 0.1) {
      // End of a phrase: the voice falls a little.
      const left = n.end - t;
      if (left >= 0 && left < 0.1) dev -= 0.4 * (1 - left / 0.1) * amount;
    }
    return dev;
  };
}

// Runs an imported humanizer model on a phrase and returns fn(t) -> semitones to add.
// session: an ONNX Runtime session; base(t) the pitch without humanizer.
export async function onnxHumanizer(ort, session, phrase, base) {
  const T = Math.max(1, Math.ceil((phrase.end - phrase.start) * HUMANIZER_FPS));
  const f0 = new Float32Array(T);
  for (let i = 0; i < T; i++) f0[i] = base(phrase.start + i / HUMANIZER_FPS);
  const input = session.inputNames[0];
  const res = await session.run({ [input]: new ort.Tensor('float32', f0, [1, T]) });
  const out = res[session.outputNames[0]].data;
  return (t) => {
    const x = (t - phrase.start) * HUMANIZER_FPS;
    const i = Math.max(0, Math.min(T - 1, Math.floor(x)));
    const j = Math.min(T - 1, i + 1);
    const f = Math.max(0, Math.min(1, x - i));
    const v = out[i] + (out[j] - out[i]) * f;
    const b = f0[i] + (f0[j] - f0[i]) * f;
    const dev = v - b;
    return Number.isFinite(dev) ? Math.max(-2, Math.min(2, dev)) : 0;
  };
}
