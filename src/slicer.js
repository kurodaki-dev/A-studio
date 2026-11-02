// Sample slicing (like Fruity Slicer): cut a sample into slices played by
// successive keys from C5, and write a pattern that replays the original groove.
import { STEP, PPQ } from './constants.js';

export function equalSlices(n) {
  return Array.from({ length: n }, (_, i) => i / n);
}

// Onsets found from jumps in short term energy. Returns slice starts in 0..1.
export function detectSlices(buf, max = 32) {
  const d = buf.getChannelData(0);
  const sr = buf.sampleRate;
  const frame = Math.max(64, Math.round(sr * 0.01));
  const energy = [];
  for (let i = 0; i + frame <= d.length; i += frame) {
    let e = 0;
    for (let j = i; j < i + frame; j++) e += d[j] * d[j];
    energy.push(e / frame);
  }
  const peak = Math.max(...energy, 1e-9);
  const out = [0];
  let avg = energy[0] || 0;
  let last = 0;
  const gap = Math.round(0.08 / 0.01);
  for (let k = 1; k < energy.length; k++) {
    const e = energy[k];
    if (e > avg * 2.2 && e > peak * 0.02 && k - last >= gap) {
      out.push((k * frame) / d.length);
      last = k;
      if (out.length >= max) break;
    }
    avg = avg * 0.85 + e * 0.15;
  }
  return out;
}

// Notes that replay the slices at their original position at the project tempo.
export function sliceNotes(slices, duration, bpm) {
  const spt = 60 / (bpm * PPQ);
  return slices.map((a, i) => {
    const b = i + 1 < slices.length ? slices[i + 1] : 1;
    const t = Math.round((a * duration) / spt / (STEP / 2)) * (STEP / 2);
    const len = Math.max(STEP / 2, Math.round(((b - a) * duration) / spt));
    return { t, len, key: 60 + i, vel: 0.8 };
  });
}
