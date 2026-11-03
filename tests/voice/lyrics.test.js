import { test } from 'node:test';
import assert from 'node:assert/strict';
import { romajiToKana, splitMora, normalizeLyric, lyricsForNotes, kanaToRomaji, moraVowel, moraPhonemes, toKatakana, toHiragana } from '../../voice/src/lyrics.js';

test('romaji becomes kana', () => {
  assert.equal(romajiToKana('karegasuki'), 'かれがすき');
  assert.equal(romajiToKana('ka re ga su ki'), 'かれがすき');
  assert.equal(romajiToKana('konnichiwa'), 'こんにちわ');
  assert.equal(romajiToKana('kitto'), 'きっと');
  assert.equal(romajiToKana('matcha'), 'まっちゃ');
  assert.equal(romajiToKana("kan'i"), 'かんい');
  assert.equal(romajiToKana('shinjite'), 'しんじて');
  assert.equal(romajiToKana('tokyo'), 'ときょ');
  assert.equal(romajiToKana('sakura'), 'さくら');
  assert.equal(romajiToKana('fuyu'), 'ふゆ');
  assert.equal(romajiToKana('n'), 'ん');
  assert.equal(romajiToKana('tsuki'), 'つき');
});

test('moras, notes and phonemes', () => {
  assert.deepEqual(splitMora('きゃりー'), ['きゃ', 'り', 'ー']);
  assert.deepEqual(lyricsForNotes('sa ku ra - R'), ['さ', 'く', 'ら', '-', 'R']);
  assert.deepEqual(lyricsForNotes('kyouha'), ['きょ', 'う', 'は']);
  assert.deepEqual(lyricsForNotes('カタカナ'), ['か', 'た', 'か', 'な']);
  assert.equal(normalizeLyric('ka'), 'か');
  assert.equal(normalizeLyric('-'), '-');
  assert.equal(normalizeLyric('R'), 'R');
  assert.equal(normalizeLyric(''), '');
  assert.equal(normalizeLyric('ア'), 'あ');
  assert.equal(kanaToRomaji('し'), 'shi');
  assert.equal(kanaToRomaji('きゃ'), 'kya');
  assert.equal(moraVowel('か'), 'a');
  assert.equal(moraVowel('ん'), 'n');
  assert.deepEqual(moraPhonemes('か'), ['k', 'a']);
  assert.deepEqual(moraPhonemes('し'), ['sh', 'i']);
  assert.deepEqual(moraPhonemes('つ'), ['ts', 'u']);
  assert.deepEqual(moraPhonemes('きゃ'), ['ky', 'a']);
  assert.deepEqual(moraPhonemes('ん'), ['N']);
  assert.deepEqual(moraPhonemes('っ'), ['cl']);
  assert.deepEqual(moraPhonemes('あ'), ['a']);
  assert.equal(toKatakana('どれみ'), 'ドレミ');
  assert.equal(toHiragana('ドレミ'), 'どれみ');
});
