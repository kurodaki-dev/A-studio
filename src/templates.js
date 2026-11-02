// Project templates: a ready made rack and a first pattern to start from.
import { newProject, makeChannel } from './store.js';
import { STEP } from './constants.js';
import { t } from './i18n.js';

const steps = (list, vel = 0.78) => list.map((s) => ({ t: s * STEP, len: STEP, key: 60, vel }));
const notes = (list) => list.map(([s, len, key, vel = 0.75, slide]) => ({ t: s * STEP, len: len * STEP, key, vel, ...(slide ? { slide: true } : {}) }));

function build(name, bpm, defs) {
  const p = newProject();
  p.name = name;
  p.bpm = bpm;
  p.channels = defs.map(([inst, label], i) => makeChannel(inst, label, i + 1));
  const pat = p.patterns[0];
  defs.forEach(([, , n], i) => {
    if (n && n.length) pat.notes[p.channels[i].id] = n;
  });
  return { p, pat };
}

export const TEMPLATES = [
  { id: 'empty', name: 'Empty', make: () => newProject() },
  {
    id: 'hiphop',
    name: 'Hip hop (90 BPM)',
    make: () => build(t('Untitled'), 90, [
      ['kick', 'Kick', steps([0, 7, 10])],
      ['snare', t('Snare'), steps([4, 12])],
      ['hat', t('Hat'), steps([0, 2, 4, 6, 8, 10, 12, 14], 0.6)],
      ['sub808', '808', notes([[0, 6, 48], [10, 6, 46]])],
      ['epiano', 'Keys', notes([[0, 8, 60, 0.6], [0, 8, 63, 0.6], [0, 8, 67, 0.6], [8, 8, 58, 0.6], [8, 8, 62, 0.6], [8, 8, 65, 0.6]])],
    ]).p,
  },
  {
    id: 'trap',
    name: 'Trap (140 BPM)',
    make: () => {
      const { p } = build(t('Untitled'), 140, [
        ['kick', 'Kick', steps([0, 10])],
        ['clap', 'Clap', steps([8])],
        ['hat', t('Hat'), [...steps([0, 2, 4, 6, 8, 10], 0.6), ...[12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5].map((s) => ({ t: s * STEP, len: STEP / 2, key: 60, vel: 0.5 }))]],
        ['sub808', '808', notes([[0, 6, 43], [10, 3, 43], [13, 3, 46, 0.75, true]])],
        ['pad', t('Pad'), notes([[0, 16, 63, 0.45], [0, 16, 67, 0.45], [0, 16, 70, 0.45]])],
      ]);
      p.channels[3].params.glide = 0.12;
      return p;
    },
  },
  {
    id: 'house',
    name: 'House (124 BPM)',
    make: () => build(t('Untitled'), 124, [
      ['kick', 'Kick', steps([0, 4, 8, 12])],
      ['clap', 'Clap', steps([4, 12])],
      ['ohat', t('Open Hat'), steps([2, 6, 10, 14], 0.55)],
      ['bass', t('Bass'), notes([[2, 1, 45], [6, 1, 45], [10, 1, 48], [14, 1, 43]])],
      ['pad', t('Pad'), notes([[0, 16, 57, 0.4], [0, 16, 60, 0.4], [0, 16, 64, 0.4]])],
    ]).p,
  },
];
