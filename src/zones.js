// Multi sample instruments: a folder of samples named after their notes
// ("Piano C4.wav", "Rhodes_F#3.wav", "bass-48.wav") becomes one sampler channel
// where each key plays the nearest sample. Sample packs name middle C "C4"
// (scientific pitch, MIDI 60), which the app shows as C5 like FL Studio.
const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export function noteFromName(name) {
  const base = String(name).replace(/\.[^.]+$/, '');
  const m = /(?:^|[^a-z])([a-g])(#|s|b)?(-?\d)(?![0-9])/i.exec(base);
  if (m) {
    let k = NOTE[m[1].toLowerCase()] + (m[2] === '#' || m[2] === 's' ? 1 : m[2] === 'b' ? -1 : 0);
    k += (Number(m[3]) + 1) * 12;
    if (k >= 0 && k < 128) return k;
  }
  const n = /(?:^|[^0-9])(\d{2,3})(?![0-9])/.exec(base);
  if (n && Number(n[1]) >= 12 && Number(n[1]) <= 120) return Number(n[1]);
  return null;
}

// samples: [{ id, name }]. Returns zones [{ key, sample }] sorted by key, one per key.
export function zonesFromSamples(samples) {
  const map = new Map();
  for (const s of samples) {
    const k = noteFromName(s.name);
    if (k != null && !map.has(k)) map.set(k, s.id);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([key, sample]) => ({ key, sample }));
}
