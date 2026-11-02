import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, normalizeProject, serialize } from '../src/store.js';
import { collectEvents, trackSound } from '../src/audio/engine.js';
import { encodeMidi } from '../src/midi.js';
import { STEP, BAR } from '../src/constants.js';

test('track sound settings', () => {
  const p = newProject();
  const pat = p.patterns[0];
  const c = p.channels[4];
  pat.notes[c.id] = [{ t: 0, key: 60, len: STEP, vel: 0.8 }];
  p.playlist.clips = [{ id: 'a', track: 0, start: 0, patternId: pat.id }, { id: 'b', track: 1, start: BAR, patternId: pat.id }];
  assert.equal(trackSound(p, p.playlist.clips[0]), null);
  Object.assign(p.playlist.tracks[1], { vol: 0.5, pan: -0.3, pitch: 7, insert: 3 });
  assert.deepEqual(trackSound(p, p.playlist.clips[1]), { i: 1, vol: 0.5, pan: -0.3, pitch: 7, insert: 3 });
  const seen = [];
  collectEvents(p, 'song', 0, BAR * 2, (ch, n, tt, pt, clip) => seen.push(clip && clip.id));
  assert.deepEqual(seen, ['a', 'b']);
  // Saved with the project
  const q = normalizeProject(JSON.parse(serialize(p)));
  assert.equal(q.playlist.tracks[1].vol, 0.5);
  assert.equal(q.playlist.tracks[1].pan, -0.3);
  assert.equal(q.playlist.tracks[1].pitch, 7);
  assert.equal(q.playlist.tracks[1].insert, 3);
  assert.equal(q.playlist.tracks[0].vol, undefined);
  // MIDI export transposes the notes of the track
  const midi = encodeMidi(p, 'song');
  const bytes = [...midi];
  const ons = [];
  for (let i = 0; i < bytes.length - 2; i++) if ((bytes[i] & 0xf0) === 0x90 && bytes[i + 2] > 0 && bytes[i + 1] < 128) ons.push(bytes[i + 1]);
  assert.ok(ons.includes(60) && ons.includes(67));
});
