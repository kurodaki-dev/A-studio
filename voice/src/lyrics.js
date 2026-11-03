// Lyrics: the singer types letters (romaji, no kanji needed) and they become kana
// automatically; each kana mora becomes phonemes for the voice engines.

const VOWELS = ['a', 'i', 'u', 'e', 'o'];

// Romaji syllables -> hiragana. Longest match first when converting.
const ROMAJI = {
  a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ',
  ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
  sa: 'さ', si: 'し', shi: 'し', su: 'す', se: 'せ', so: 'そ',
  za: 'ざ', zi: 'じ', ji: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  ta: 'た', ti: 'ち', chi: 'ち', tu: 'つ', tsu: 'つ', te: 'て', to: 'と',
  da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど',
  na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
  ha: 'は', hi: 'ひ', hu: 'ふ', fu: 'ふ', he: 'へ', ho: 'ほ',
  ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
  pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
  ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
  ya: 'や', yu: 'ゆ', yo: 'よ', ye: 'いぇ',
  ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ',
  la: 'ら', li: 'り', lu: 'る', le: 'れ', lo: 'ろ',
  wa: 'わ', wi: 'うぃ', we: 'うぇ', wo: 'を',
  va: 'ゔぁ', vi: 'ゔぃ', vu: 'ゔ', ve: 'ゔぇ', vo: 'ゔぉ',
  fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ',
  kya: 'きゃ', kyu: 'きゅ', kyo: 'きょ', kye: 'きぇ',
  gya: 'ぎゃ', gyu: 'ぎゅ', gyo: 'ぎょ',
  sha: 'しゃ', shu: 'しゅ', sho: 'しょ', she: 'しぇ', sya: 'しゃ', syu: 'しゅ', syo: 'しょ',
  ja: 'じゃ', ju: 'じゅ', jo: 'じょ', je: 'じぇ', jya: 'じゃ', jyu: 'じゅ', jyo: 'じょ', zya: 'じゃ', zyu: 'じゅ', zyo: 'じょ',
  cha: 'ちゃ', chu: 'ちゅ', cho: 'ちょ', che: 'ちぇ', tya: 'ちゃ', tyu: 'ちゅ', tyo: 'ちょ',
  nya: 'にゃ', nyu: 'にゅ', nyo: 'にょ',
  hya: 'ひゃ', hyu: 'ひゅ', hyo: 'ひょ',
  bya: 'びゃ', byu: 'びゅ', byo: 'びょ',
  pya: 'ぴゃ', pyu: 'ぴゅ', pyo: 'ぴょ',
  mya: 'みゃ', myu: 'みゅ', myo: 'みょ',
  rya: 'りゃ', ryu: 'りゅ', ryo: 'りょ',
  tsa: 'つぁ', tsi: 'つぃ', tse: 'つぇ', tso: 'つぉ',
  thi: 'てぃ', dhi: 'でぃ', twu: 'とぅ', dwu: 'どぅ',
  n: 'ん', nn: 'ん', "n'": 'ん', xtsu: 'っ', ltsu: 'っ',
};
const KEYS = Object.keys(ROMAJI).sort((a, b) => b.length - a.length);

// Hiragana -> romaji (for display and phonemes); the reverse of the table above.
const KANA_ROMAJI = {};
for (const [r, k] of Object.entries(ROMAJI)) {
  if (r === 'nn' || r === "n'" || r.startsWith('l') || r.startsWith('x')) continue;
  if (!(k in KANA_ROMAJI) || r.length < KANA_ROMAJI[k].length || (r.length === KANA_ROMAJI[k].length && ['shi', 'chi', 'tsu', 'fu', 'ji', 'sha', 'shu', 'sho', 'ja', 'ju', 'jo', 'cha', 'chu', 'cho'].includes(r))) KANA_ROMAJI[k] = r;
}
Object.assign(KANA_ROMAJI, { し: 'shi', ち: 'chi', つ: 'tsu', ふ: 'fu', じ: 'ji', ぢ: 'ji', づ: 'zu', を: 'o', っ: 'cl', ん: 'N', ゔ: 'vu' });

const SMALL = 'ぁぃぅぇぉゃゅょゎ';

export const isKana = (s) => /^[぀-ヿー]+$/.test(s);
export const hasLatin = (s) => /[a-zA-Z]/.test(s);

// Katakana -> hiragana (the voice tables use hiragana).
export function toHiragana(s) {
  return String(s).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function toKatakana(s) {
  return String(s).replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

// "karegasuki" or "ka re ga su ki" -> "かれがすき". Double consonants become っ,
// "n" before a consonant or at the end becomes ん. Unknown letters are dropped.
export function romajiToKana(text) {
  const s = String(text).toLowerCase().replace(/[-_.,!?'’"]/g, (c) => (c === "'" || c === '’' ? "'" : ' '));
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') {
      i++;
      continue;
    }
    if (!/[a-z']/.test(c)) {
      out += c;
      i++;
      continue;
    }
    // Small tsu: a doubled consonant (kk, tt, pp, ss... but not nn).
    if (c !== 'n' && !VOWELS.includes(c) && s[i + 1] === c) {
      out += 'っ';
      i++;
      continue;
    }
    if (c === 't' && s[i + 1] === 'c' && s[i + 2] === 'h') {
      out += 'っ';
      i++;
      continue;
    }
    // n: syllabic before a consonant (not y), at a space or at the end.
    if (c === 'n') {
      const nx = s[i + 1];
      if (nx === "'") {
        out += 'ん';
        i += 2;
        continue;
      }
      if (nx === 'n') {
        // "nn" + vowel (konnichiwa): ん then a n- syllable; otherwise "nn" is one ん.
        const after = s[i + 2];
        out += 'ん';
        i += after && (VOWELS.includes(after) || after === 'y') ? 1 : 2;
        continue;
      }
      if (nx === undefined || nx === ' ' || (!VOWELS.includes(nx) && nx !== 'y')) {
        out += 'ん';
        i++;
        continue;
      }
    }
    let hit = null;
    for (const k of KEYS) {
      if (k !== 'n' && k !== 'nn' && k !== "n'" && s.startsWith(k, i)) {
        hit = k;
        break;
      }
    }
    if (hit) {
      out += ROMAJI[hit];
      i += hit.length;
    } else i++;
  }
  return out;
}

// Splits kana into moras: "きゃりー" -> ["きゃ", "り", "ー"].
export function splitMora(kana) {
  const s = toHiragana(kana);
  const out = [];
  for (const ch of s) {
    if (SMALL.includes(ch) && out.length) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

// A typed lyric for one note: letters become kana. Special lyrics stay as they are:
// "-" (or "+") holds the previous vowel, "R" or "" is a rest, "br" a breath.
export function normalizeLyric(text) {
  const s = String(text == null ? '' : text).trim();
  if (s === '' || s === 'R' || s === 'r') return s ? 'R' : '';
  if (s === '-' || s === '+' || s === 'ー') return '-';
  if (s.toLowerCase() === 'br' || s.toLowerCase() === 'breath') return 'br';
  if (hasLatin(s)) {
    const k = romajiToKana(s);
    return k || s;
  }
  return toHiragana(s);
}

// A phrase of lyrics for several notes: letters or kana, split into one mora per note.
// "ka re ga su ki" or "かれがすき" -> ["か", "れ", "が", "す", "き"]. "-" holds a vowel.
export function lyricsForNotes(text) {
  const parts = [];
  for (const word of String(text).trim().split(/\s+/)) {
    if (!word) continue;
    if (word === '-' || word === '+' || word === 'R' || word.toLowerCase() === 'br') {
      parts.push(normalizeLyric(word));
      continue;
    }
    const kana = hasLatin(word) ? romajiToKana(word) : toHiragana(word);
    parts.push(...splitMora(kana));
  }
  return parts;
}

export function kanaToRomaji(mora) {
  const m = toHiragana(mora);
  if (m === 'ー' || m === '-') return '-';
  if (KANA_ROMAJI[m]) return KANA_ROMAJI[m];
  return [...m].map((c) => KANA_ROMAJI[c] || c).join('');
}

// The vowel a mora ends on ("か" -> "a", "ん" -> "N"), for VCV voicebanks and holds.
export function moraVowel(mora) {
  const r = kanaToRomaji(mora);
  if (r === 'N') return 'n';
  const v = r[r.length - 1];
  return VOWELS.includes(v) ? v : null;
}

// Japanese phonemes of a mora, in the usual DiffSinger names:
// "か" -> ["k", "a"], "し" -> ["sh", "i"], "ん" -> ["N"], "っ" -> ["cl"], "あ" -> ["a"].
export function moraPhonemes(mora) {
  const m = toHiragana(mora);
  if (m === 'ん') return ['N'];
  if (m === 'っ') return ['cl'];
  const r = kanaToRomaji(m);
  if (!r || r === '-') return [];
  if (VOWELS.includes(r)) return [r];
  const v = r[r.length - 1];
  if (!VOWELS.includes(v)) return [r];
  let c = r.slice(0, -1);
  if (c === 'y' || c === 'w') return [c, v];
  return [c, v];
}

// Display form of a lyric: kana plus romaji in small, for the piano roll.
export function lyricLabel(lyric) {
  if (lyric === '-' || lyric === 'R' || lyric === 'br' || !lyric) return lyric || '';
  return isKana(lyric) ? lyric : lyric;
}
