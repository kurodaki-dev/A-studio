import { getPlugin } from '../plugins.js';
import { t } from '../i18n.js';
// Instrument list. All sounds are synthesized in real time, no samples.
export const CATEGORIES = [
  { id: 'drums', name: t('Drums'), icon: 'Drum' },
  { id: 'keys', name: t('Keys'), icon: 'Piano' },
  { id: 'bass', name: t('Bass'), icon: 'AudioWaveform' },
  { id: 'synth', name: t('Synths'), icon: 'AudioLines' },
  { id: 'strings', name: t('Strings'), icon: 'Guitar' },
  { id: 'winds', name: t('Winds'), icon: 'Wind' },
  { id: 'mallets', name: t('Mallets'), icon: 'Bell' },
];

export const CATALOG = [
  { id: 'kick', name: 'Kick', cat: 'drums' },
  { id: 'snare', name: t('Snare'), cat: 'drums' },
  { id: 'clap', name: 'Clap', cat: 'drums' },
  { id: 'hat', name: t('Closed Hat'), cat: 'drums' },
  { id: 'ohat', name: t('Open Hat'), cat: 'drums' },
  { id: 'crash', name: 'Crash', cat: 'drums' },
  { id: 'tom', name: 'Tom', cat: 'drums' },
  { id: 'rim', name: 'Rimshot', cat: 'drums' },
  { id: 'cowbell', name: t('Cowbell'), cat: 'drums' },
  { id: 'piano', name: 'Piano', cat: 'keys' },
  { id: 'epiano', name: t('Electric Piano'), cat: 'keys' },
  { id: 'organ', name: t('Organ'), cat: 'keys' },
  { id: 'bass', name: t('Synth Bass'), cat: 'bass' },
  { id: 'sub808', name: t('808 Bass'), cat: 'bass' },
  { id: 'lead', name: 'Lead', cat: 'synth' },
  { id: 'pad', name: t('Pad'), cat: 'synth' },
  { id: 'pluck', name: 'Pluck', cat: 'synth' },
  { id: 'osc3', name: '3x Osc', cat: 'synth' },
  { id: 'strings', name: t('String Ensemble'), cat: 'strings' },
  { id: 'guitar', name: t('Guitar'), cat: 'strings' },
  { id: 'flute', name: t('Flute'), cat: 'winds' },
  { id: 'brass', name: t('Brass'), cat: 'winds' },
  { id: 'marimba', name: 'Marimba', cat: 'mallets' },
  { id: 'bell', name: t('Bell'), cat: 'mallets' },
];

// The sampler plays an imported sample. It is created by dropping a sample, not picked from the list.
export const INSTRUMENT_IDS = [...CATALOG.map((i) => i.id), 'sampler'];
export const instrumentName = (id) => {
  if (id === 'sampler') return 'Sampler';
  if (id.startsWith('plugin:')) return (getPlugin(id.slice(7)) || { name: id.slice(7) }).name;
  return (CATALOG.find((i) => i.id === id) || { name: id }).name;
};
export const isInstrumentId = (id) => typeof id === 'string' && (INSTRUMENT_IDS.includes(id) || /^plugin:[a-z0-9-]{1,40}$/.test(id));
export const instrumentCat = (id) => (CATALOG.find((i) => i.id === id) || { cat: 'keys' }).cat;
