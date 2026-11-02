import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, normalizeProject, serialize } from '../src/store.js';
import { swingTicks, collectEvents } from '../src/audio/engine.js';
import { encodeMidi } from '../src/midi.js';
import { STEP } from '../src/constants.js';

test('swing delays odd steps only and is saved', () => {
  const pat = { swing: 1 };
  assert.equal(swingTicks(pat, 0), 0);
  assert.equal(swingTicks(pat, STEP), STEP / 2);
  assert.equal(swingTicks(pat, 2 * STEP), 0);
  assert.equal(swingTicks(pat, STEP + 3), 0, 'notes off the grid are not moved');
  assert.equal(swingTicks({ swing: 0 }, STEP), 0);
  const raw = JSON.parse(serialize(newProject()));
  raw.patterns[0].swing = 7;
  assert.equal(normalizeProject(raw).patterns[0].swing, 1);
});

test('collectEvents passes the pattern so swing can be applied', () => {
  const p = newProject();
  const pat = p.patterns[0];
  pat.notes[p.channels[0].id] = [{ t: STEP, len: STEP, key: 60, vel: 1 }];
  const got = [];
  collectEvents(p, 'pattern', 0, 384, (c, n, tt, pt) => got.push(pt));
  assert.equal(got[0], pat);
});

// Minimal MIDI reader for the test.
function readMidi(bytes) {
  const dv = new DataView(bytes.buffer);
  const str = (o) => String.fromCharCode(...bytes.slice(o, o + 4));
  assert.equal(str(0), 'MThd');
  const tracks = dv.getUint16(10);
  const ppq = dv.getUint16(12);
  let o = 14;
  const out = [];
  for (let tr = 0; tr < tracks; tr++) {
    assert.equal(str(o), 'MTrk');
    const len = dv.getUint32(o + 4);
    let p = o + 8;
    const end = p + len;
    let tick = 0;
    let status = 0;
    const events = [];
    while (p < end) {
      let d = 0;
      let b;
      do { b = bytes[p++]; d = (d << 7) | (b & 0x7f); } while (b & 0x80);
      tick += d;
      if (bytes[p] === 0xff) {
        const type = bytes[p + 1];
        const l = bytes[p + 2];
        events.push({ tick, meta: type, data: [...bytes.slice(p + 3, p + 3 + l)] });
        p += 3 + l;
      } else {
        status = bytes[p++];
        const hi = status & 0xf0;
        const n = hi === 0xc0 || hi === 0xd0 ? 1 : 2;
        events.push({ tick, status, data: [...bytes.slice(p, p + n)] });
        p += n;
      }
    }
    out.push(events);
    o = end;
  }
  return { ppq, tracks: out };
}

test('MIDI export writes tempo, GM drums on channel 10 and programs', () => {
  const p = newProject();
  p.bpm = 120;
  const [kick, , , , piano] = p.channels;
  p.patterns[0].notes[kick.id] = [{ t: 0, len: STEP, key: 60, vel: 1 }, { t: 96, len: STEP, key: 60, vel: 0.5 }];
  p.patterns[0].notes[piano.id] = [{ t: 0, len: 96, key: 64, vel: 0.78 }];
  const m = readMidi(encodeMidi(p, 'pattern'));
  assert.equal(m.ppq, 96);
  assert.equal(m.tracks.length, 3);
  const tempo = m.tracks[0].find((e) => e.meta === 0x51).data;
  assert.equal((tempo[0] << 16) | (tempo[1] << 8) | tempo[2], 500000);
  const kickOn = m.tracks[1].filter((e) => (e.status & 0xf0) === 0x90);
  assert.deepEqual(kickOn.map((e) => [e.tick, e.status & 0x0f, e.data[0], e.data[1]]), [[0, 9, 36, 127], [96, 9, 36, 64]]);
  const prog = m.tracks[2].find((e) => (e.status & 0xf0) === 0xc0);
  assert.equal(prog.data[0], 0);
  const pianoOn = m.tracks[2].find((e) => (e.status & 0xf0) === 0x90);
  const pianoOff = m.tracks[2].find((e) => (e.status & 0xf0) === 0x80);
  assert.equal(pianoOn.data[0], 64);
  assert.equal(pianoOff.tick, 96);
  assert.notEqual(pianoOn.status & 0x0f, 9);
});
