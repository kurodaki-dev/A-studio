// Instrument list. All sounds are synthesized in real time, no samples.
export const CATEGORIES = [
  { id: 'drums', name: 'Batterie', icon: 'Drum' },
  { id: 'keys', name: 'Claviers', icon: 'Piano' },
  { id: 'bass', name: 'Basses', icon: 'AudioWaveform' },
  { id: 'synth', name: 'Synthés', icon: 'AudioLines' },
  { id: 'strings', name: 'Cordes', icon: 'Guitar' },
  { id: 'winds', name: 'Vents', icon: 'Wind' },
  { id: 'mallets', name: 'Percussions mélodiques', icon: 'Bell' },
];

export const CATALOG = [
  { id: 'kick', name: 'Kick', cat: 'drums' },
  { id: 'snare', name: 'Caisse claire', cat: 'drums' },
  { id: 'clap', name: 'Clap', cat: 'drums' },
  { id: 'hat', name: 'Charleston fermé', cat: 'drums' },
  { id: 'ohat', name: 'Charleston ouvert', cat: 'drums' },
  { id: 'crash', name: 'Crash', cat: 'drums' },
  { id: 'tom', name: 'Tom', cat: 'drums' },
  { id: 'rim', name: 'Rimshot', cat: 'drums' },
  { id: 'cowbell', name: 'Cloche à vache', cat: 'drums' },
  { id: 'piano', name: 'Piano', cat: 'keys' },
  { id: 'epiano', name: 'Piano électrique', cat: 'keys' },
  { id: 'organ', name: 'Orgue', cat: 'keys' },
  { id: 'bass', name: 'Basse synthé', cat: 'bass' },
  { id: 'sub808', name: 'Basse 808', cat: 'bass' },
  { id: 'lead', name: 'Lead', cat: 'synth' },
  { id: 'pad', name: 'Nappe', cat: 'synth' },
  { id: 'pluck', name: 'Pluck', cat: 'synth' },
  { id: 'strings', name: 'Ensemble de cordes', cat: 'strings' },
  { id: 'guitar', name: 'Guitare', cat: 'strings' },
  { id: 'flute', name: 'Flûte', cat: 'winds' },
  { id: 'brass', name: 'Cuivres', cat: 'winds' },
  { id: 'marimba', name: 'Marimba', cat: 'mallets' },
  { id: 'bell', name: 'Cloche', cat: 'mallets' },
];

// The sampler plays an imported sample. It is created by dropping a sample, not picked from the list.
export const INSTRUMENT_IDS = [...CATALOG.map((i) => i.id), 'sampler'];
export const instrumentName = (id) => (id === 'sampler' ? 'Sampler' : (CATALOG.find((i) => i.id === id) || { name: id }).name);
export const instrumentCat = (id) => (CATALOG.find((i) => i.id === id) || { cat: 'keys' }).cat;
