import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUst, parseMidi } from '../../voice/src/formats.js';

test('UST import', () => {
  const ust = '[#VERSION]\nUST Version1.2\n[#SETTING]\nTempo=140\n[#0000]\nLength=480\nLyric=R\nNoteNum=60\n[#0001]\nLength=240\nLyric=か\nNoteNum=62\n[#0002]\nLength=480\nLyric=a さ\nNoteNum=64\nIntensity=100\n[#TRACKEND]\n';
  const r = parseUst(ust);
  assert.equal(r.tempo, 140);
  assert.deepEqual(r.notes.map((n) => [n.t, n.len, n.key, n.lyric]), [[480, 240, 62, 'か'], [720, 480, 64, 'さ']]);
  assert.equal(r.notes[1].vel, 0.8);
});

test('MIDI import with lyrics', () => {
  const vlq = (n) => (n < 128 ? [n] : [0x80 | (n >> 7), n & 0x7f]);
  const ev = [];
  const add = (d, ...b) => ev.push(...vlq(d), ...b);
  add(0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20); // 120 BPM
  add(0, 0xff, 0x05, 2, 0x6b, 0x61); // lyric "ka"
  add(0, 0x90, 60, 100);
  add(96, 0x80, 60, 0);
  add(0, 0xff, 0x05, 2, 0x73, 0x61); // "sa"
  add(0, 0x90, 62, 80);
  add(96, 0x90, 62, 0);
  add(0, 0xff, 0x2f, 0);
  const hd = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96];
  const tk = [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, ev.length, ...ev];
  const r = parseMidi(new Uint8Array([...hd, ...tk]));
  assert.equal(r.tempo, 120);
  assert.deepEqual(r.notes.map((n) => [n.t, n.len, n.key, n.lyric]), [[0, 480, 60, 'か'], [480, 480, 62, 'さ']]);
  assert.throws(() => parseMidi(new Uint8Array(20)));
});
