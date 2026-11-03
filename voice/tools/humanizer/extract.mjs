// Pitch curves (MIDI notes, 100 frames per second, 0 = unvoiced) of the singing clips,
// with the same YIN tracker as A Voice Studio. Output: one Float32 file + an index.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { decodeWav, pitchTrack } from '../../src/dsp.js';

const dir = process.argv[2];
const out = process.argv[3];
const files = readdirSync(dir).filter((f) => f.endsWith('.wav')).sort();
const chunks = [];
const index = [];
let pos = 0;
for (const f of files) {
  let w;
  try {
    w = decodeWav(readFileSync(dir + '/' + f));
  } catch {
    continue;
  }
  const tr = pitchTrack(w.data, w.sr, { hop: 0.01, fmin: 65, fmax: 1100, threshold: 0.12 });
  const midi = Float32Array.from(tr, (hz) => (hz > 0 ? 69 + 12 * Math.log2(hz / 440) : 0));
  chunks.push(midi);
  index.push({ file: f, singer: f.split('_')[0], start: pos, len: midi.length });
  pos += midi.length;
}
const all = new Float32Array(pos);
let o = 0;
for (const c of chunks) {
  all.set(c, o);
  o += c.length;
}
writeFileSync(out + '.f32', Buffer.from(all.buffer));
writeFileSync(out + '.json', JSON.stringify(index));
console.log(files.length, 'clips,', (pos / 100 / 60).toFixed(1), 'minutes');
