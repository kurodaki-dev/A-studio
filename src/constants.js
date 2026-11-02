import { t } from './i18n.js';
// Time base: 96 ticks per quarter note, as in FL Studio.
export const PPQ = 96;
export const STEP = 24; // a 1/16 step
export const BEAT = 96;
// Bar length follows the project time signature (beats of a quarter note).
// ES module imports are live bindings, so every module sees the new value.
export let BAR = 384; // 4/4
export const TIME_SIGS = [2, 3, 4, 5, 6, 7];
export function setBeatsPerBar(n) {
  BAR = (TIME_SIGS.includes(n) ? n : 4) * 96;
}

export const NKEYS = 132; // C0 to B10, MIDI 0 to 131
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// FL Studio names MIDI 60 "C5".
export const noteName = (k) => NOTE_NAMES[((k % 12) + 12) % 12] + Math.floor(k / 12);
export const isBlack = (k) => [1, 3, 6, 8, 10].includes(((k % 12) + 12) % 12);

export const SNAPS = [
  { id: 'none', label: t('None'), ticks: 1 },
  { id: '1/6s', label: t('1/6 step'), ticks: 4 },
  { id: '1/4s', label: t('1/4 step'), ticks: 6 },
  { id: '1/3s', label: t('1/3 step'), ticks: 8 },
  { id: '1/2s', label: t('1/2 step'), ticks: 12 },
  { id: 'step', label: t('Step'), ticks: 24 },
  { id: '1/6b', label: t('1/6 beat'), ticks: 16 },
  { id: '1/3b', label: t('1/3 beat'), ticks: 32 },
  { id: '1/2b', label: t('1/2 beat'), ticks: 48 },
  { id: 'beat', label: t('Beat'), ticks: 96 },
  { id: 'bar', label: t('Bar'), get ticks() { return BAR; } },
];

export const snapTicks = (id) => (SNAPS.find((s) => s.id === id) || SNAPS[5]).ticks;

export const MIXER_SIZE = 17; // master + 16 inserts
export const TRACKS = 16;

export const PATTERN_COLORS = ['#6f9e5b', '#4f86a3', '#b08647', '#a65e5e', '#5f9c8f', '#9c9a4f', '#8a6f5a', '#6d7f99'];

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
