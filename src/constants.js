// Time base: 96 ticks per quarter note, as in FL Studio.
export const PPQ = 96;
export const STEP = 24; // a 1/16 step
export const BEAT = 96;
export const BAR = 384; // 4/4

export const NKEYS = 132; // C0 to B10, MIDI 0 to 131
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// FL Studio names MIDI 60 "C5".
export const noteName = (k) => NOTE_NAMES[((k % 12) + 12) % 12] + Math.floor(k / 12);
export const isBlack = (k) => [1, 3, 6, 8, 10].includes(((k % 12) + 12) % 12);

export const SNAPS = [
  { id: 'none', label: 'Aucun', ticks: 1 },
  { id: '1/6s', label: '1/6 de pas', ticks: 4 },
  { id: '1/4s', label: '1/4 de pas', ticks: 6 },
  { id: '1/3s', label: '1/3 de pas', ticks: 8 },
  { id: '1/2s', label: '1/2 pas', ticks: 12 },
  { id: 'step', label: 'Pas', ticks: 24 },
  { id: '1/6b', label: '1/6 de temps', ticks: 16 },
  { id: '1/3b', label: '1/3 de temps', ticks: 32 },
  { id: '1/2b', label: '1/2 temps', ticks: 48 },
  { id: 'beat', label: 'Temps', ticks: 96 },
  { id: 'bar', label: 'Mesure', ticks: 384 },
];

export const snapTicks = (id) => (SNAPS.find((s) => s.id === id) || SNAPS[5]).ticks;

export const MIXER_SIZE = 17; // master + 16 inserts
export const TRACKS = 16;

export const PATTERN_COLORS = ['#6f9e5b', '#4f86a3', '#b08647', '#a65e5e', '#5f9c8f', '#9c9a4f', '#8a6f5a', '#6d7f99'];

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
