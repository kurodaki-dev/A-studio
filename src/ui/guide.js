import { h, icon, openModal } from './dom.js';
import { t } from '../i18n.js';

const KEY = 'astudio:guided';

const STEPS = [
  { icon: 'Music', title: 'Welcome to A Studio', text: ['A Studio works like FL Studio: you make patterns in the channel rack and the piano roll, then arrange them in the playlist.', 'Start from a template with Menu, New project, or keep the beat that is already loaded.'] },
  { icon: 'Grid3x3', title: 'Channel rack', text: ['Each row is a sound. Tap the steps to make a beat, and press Play (or the space bar).', 'Tap a channel name for its menu: piano roll, settings, fill each 4 steps, solo, color.'] },
  { icon: 'Piano', title: 'Piano roll', text: ['Tap to place notes, drag to move them, drag the right edge to make them longer.', 'The wand menu writes chords and arpeggios, the note menu shows a scale so you stay in key.'] },
  { icon: 'LayoutList', title: 'Playlist', text: ['Switch to SONG, then tap the playlist to place the current pattern. Long press a clip for its menu.', 'Add automation clips, markers and a loop region from the playlist toolbar.'] },
  { icon: 'Mic', title: 'Record your voice', text: ['The red circle is the record menu: set up a vocal insert with auto tune, hear yourself with headphones, show your lyrics and record takes.', 'Measure the recording latency once in Settings so your takes sit on the beat.'] },
  { icon: 'Download', title: 'Mix and share', text: ['The mixer has an EQ, effects and a master meter that tells you the loudness in LUFS.', 'Menu, Export: WAV, MP3, stems, MIDI, or the whole project with its samples to open it on another phone.'] },
];

export const guideSeen = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true;
  }
};

export function openGuide() {
  let i = 0;
  const body = h('div');
  let m = null;
  const done = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
  };
  function render() {
    const s = STEPS[i];
    body.replaceChildren(
      h('div', { class: 'guide' },
        h('div', { class: 'guide-ic' }, icon(s.icon, 28)),
        h('div', null, h('h3', null, t(s.title)), s.text.map((p) => h('p', null, t(p))),
          h('div', { class: 'guide-dots' }, STEPS.map((_, k) => h('i', { class: k === i ? 'on' : '' })))),
      ),
    );
  }
  render();
  const next = () => {
    if (i < STEPS.length - 1) {
      i += 1;
      render();
      return false;
    }
    done();
    return true;
  };
  m = openModal({
    title: t('Getting started'),
    body,
    onClose: done,
    actions: [
      { label: t('Skip') },
      { label: t('Back'), onClick: () => { if (i > 0) { i -= 1; render(); } return false; } },
      { label: t('Next'), primary: true, onClick: next },
    ],
  });
  return m;
}
