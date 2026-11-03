// DiffSinger voicebanks (OpenUtau layout): dsconfig.yaml, a phoneme list, an acoustic
// model (ONNX) and an NSF-HiFiGAN vocoder (bundled in dsvocoder/ or installed apart).
// The models run on the device with ONNX Runtime (WebAssembly), like in OpenUtau.
import YAML from 'yaml';
import { decodeText } from '../zip.js';
import { resample } from '../dsp.js';
import { moraPhonemes, kanaToRomaji } from '../lyrics.js';
import { timeline, midiToHz } from '../phrase.js';

// ONNX Runtime is loaded on first use (about 14 MB of WebAssembly).
let ortPromise = null;
let ortLoader = async () => {
  // The WebAssembly file is bundled next to the page by the build.
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  return ort;
};
export function setOrtLoader(fn) {
  ortLoader = fn;
  ortPromise = null;
}
export function getOrt() {
  if (!ortPromise) ortPromise = ortLoader().catch((e) => { ortPromise = null; throw e; });
  return ortPromise;
}

const HEAD = 8;
const TAIL = 8;

// dsconfig keys exist in snake_case (files) and camelCase (OpenUtau fields).
function cfg(c, ...names) {
  for (const n of names) {
    if (c[n] !== undefined) return c[n];
    const snake = n.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    if (c[snake] !== undefined) return c[snake];
  }
  return undefined;
}

export function parseDsConfig(text) {
  const c = YAML.parse(text) || {};
  const useCA = !!cfg(c, 'useContinuousAcceleration');
  const varDepth = cfg(c, 'useVariableDepth', 'use_shallow_diffusion');
  const maxDepthRaw = Number(cfg(c, 'max_depth', 'maxDepth') ?? 0);
  const range = cfg(c, 'augmentationArgs')?.random_pitch_shifting?.range || cfg(c, 'augmentationArgs')?.randomPitchShifting?.range || null;
  return {
    phonemes: cfg(c, 'phonemes') || 'phonemes.txt',
    languages: cfg(c, 'languages') || null,
    acoustic: cfg(c, 'acoustic') || null,
    vocoder: cfg(c, 'vocoder') || null,
    speakers: Array.isArray(cfg(c, 'speakers')) ? cfg(c, 'speakers') : null,
    hiddenSize: Number(cfg(c, 'hiddenSize', 'hidden_size') || 256),
    useKeyShiftEmbed: !!cfg(c, 'useKeyShiftEmbed'),
    useSpeedEmbed: !!cfg(c, 'useSpeedEmbed'),
    useEnergyEmbed: !!cfg(c, 'useEnergyEmbed'),
    useBreathinessEmbed: !!cfg(c, 'useBreathinessEmbed'),
    useVoicingEmbed: !!cfg(c, 'useVoicingEmbed'),
    useTensionEmbed: !!cfg(c, 'useTensionEmbed'),
    keyShiftRange: Array.isArray(range) ? range.map(Number) : [-5, 5],
    useContinuousAcceleration: useCA,
    useLangId: !!cfg(c, 'use_lang_id'),
    useVariableDepth: !!varDepth,
    maxDepth: useCA ? maxDepthRaw : maxDepthRaw / 1000,
    sampleRate: Number(cfg(c, 'sample_rate') || 44100),
    hopSize: Number(cfg(c, 'hop_size') || 512),
    winSize: Number(cfg(c, 'win_size') || 2048),
    fftSize: Number(cfg(c, 'fft_size') || 2048),
    melBins: Number(cfg(c, 'num_mel_bins') || 128),
    melFmin: Number(cfg(c, 'mel_fmin') ?? 40),
    melFmax: Number(cfg(c, 'mel_fmax') ?? 16000),
    melBase: String(cfg(c, 'mel_base') ?? '10'),
    melScale: String(cfg(c, 'mel_scale') ?? 'slaney'),
  };
}

export function parseVocoderYaml(text) {
  const c = YAML.parse(text) || {};
  return {
    name: c.name || '',
    model: c.model || 'model.onnx',
    sampleRate: Number(c.sample_rate || 44100),
    hopSize: Number(c.hop_size || 512),
    winSize: Number(c.win_size || 2048),
    fftSize: Number(c.fft_size || 2048),
    melBins: Number(c.num_mel_bins || 128),
    melFmin: Number(c.mel_fmin ?? 40),
    melFmax: Number(c.mel_fmax ?? 16000),
    melBase: String(c.mel_base ?? '10'),
    melScale: String(c.mel_scale ?? 'slaney'),
    pitchControllable: !!c.pitch_controllable,
  };
}

export function parsePhonemes(name, text) {
  const map = new Map();
  if (/\.json$/i.test(name)) {
    for (const [k, v] of Object.entries(JSON.parse(text))) map.set(k, Number(v));
  } else {
    text.split(/\r?\n/).forEach((l, i) => {
      if (l !== '' || i === 0) map.set(l.trim(), i);
    });
  }
  return map;
}

// dsdict.yaml -> { entries: Map(grapheme -> phonemes), types: Map(symbol -> type) }.
export function parseDsDict(text) {
  const d = YAML.parse(text) || {};
  const types = new Map();
  for (const s of d.symbols || []) if (s && s.symbol) types.set(String(s.symbol), String(s.type || ''));
  const entries = new Map();
  for (const e of d.entries || []) if (e && e.grapheme != null && Array.isArray(e.phonemes)) entries.set(String(e.grapheme), e.phonemes.map(String));
  return { entries, types };
}

// The vocoder must match the acoustic model, like in OpenUtau.
export function checkVocoder(ds, v) {
  const errs = [];
  if (v.sampleRate !== ds.sampleRate) errs.push('sample rate');
  if (v.hopSize !== ds.hopSize) errs.push('hop size');
  if (v.winSize !== ds.winSize) errs.push('window size');
  if (v.fftSize !== ds.fftSize) errs.push('FFT size');
  if (v.melBins !== ds.melBins) errs.push('mel bins');
  if (Math.abs(v.melFmin - ds.melFmin) > 1e-5) errs.push('fmin');
  if (Math.abs(v.melFmax - ds.melFmax) > 1e-5) errs.push('fmax');
  if (v.melScale !== ds.melScale) errs.push('mel scale');
  return errs;
}

// OpenUtau's rounding of phoneme durations to frames (half to even).
const roundEven = (x) => {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
};
export function msToFrames(durationsMs, frameMs) {
  const out = [];
  let acc = 0;
  let prev = 0;
  for (const d of durationsMs) {
    acc += Math.max(0, d);
    const frame = roundEven(acc / frameMs + 0.5);
    out.push(frame - prev);
    prev = frame;
  }
  return out;
}

const joinPath = (root, p) => (root ? root.replace(/\/?$/, '/') : '') + String(p).replace(/^\.?\//, '');
const lower = (s) => s.toLowerCase();

// Loads a DiffSinger bank from a source ({ names, read(path) }) at the folder `root`.
// findVocoder(name, config) gives an installed vocoder { config, read() } or null.
export async function loadDiffSinger(src, root = '', findVocoder = async () => null) {
  const byLower = new Map(src.names.map((n) => [lower(n), n]));
  const real = (p) => byLower.get(lower(joinPath(root, p))) || null;
  const text = async (p) => {
    const r = real(p);
    return r ? decodeText(await src.read(r)) : null;
  };
  const cfgText = await text('dsconfig.yaml');
  if (!cfgText) throw new Error('dsconfig.yaml not found');
  const ds = parseDsConfig(cfgText);
  if (!ds.acoustic) throw new Error('dsconfig.yaml has no "acoustic" model');
  const phText = await text(ds.phonemes);
  if (phText == null) throw new Error('Phoneme list not found: ' + ds.phonemes);
  const phonemes = parsePhonemes(ds.phonemes, phText);
  let languages = null;
  if (ds.useLangId && ds.languages) {
    const lt = await text(ds.languages);
    if (lt) languages = new Map(Object.entries(JSON.parse(lt)).map(([k, v]) => [k, Number(v)]));
  }
  // Dictionary: dsdur/ first (like OpenUtau), then the bank root, then any dsdict*.yaml.
  let dict = { entries: new Map(), types: new Map() };
  const dictPath = ['dsdur/dsdict.yaml', 'dsdict.yaml', 'dsvariance/dsdict.yaml', 'dspitch/dsdict.yaml'].map(real).find(Boolean)
    || src.names.find((n) => n.startsWith(joinPath(root, '')) && /dsdict[^/]*\.yaml$/i.test(n));
  if (dictPath) dict = parseDsDict(decodeText(await src.read(dictPath)));
  // Variance predictor (dsvariance/): energy, breathiness... curves for the acoustic
  // model, predicted from the phonemes and the pitch, like OpenUtau.
  let variance = null;
  const vt = await text('dsvariance/dsconfig.yaml');
  if (vt) {
    const vc = YAML.parse(vt) || {};
    const vph = await text('dsvariance/' + (vc.phonemes || 'phonemes.txt'));
    if (vc.linguistic && vc.variance && vph != null) {
      variance = {
        linguistic: 'dsvariance/' + vc.linguistic,
        variance: 'dsvariance/' + vc.variance,
        phonemes: parsePhonemes(vc.phonemes || 'phonemes.txt', vph),
        continuous: !!vc.use_continuous_acceleration,
      };
    }
  }
  const ch = await text('character.yaml');
  const chText = await text('character.txt');
  let name = root.split('/').filter(Boolean).pop() || 'DiffSinger';
  let image = null;
  const c = ch ? YAML.parse(ch) || {} : {};
  if (c.text) name = String(c.text);
  else if (chText) {
    const m = /^\s*name\s*=\s*(.*)$/im.exec(chText);
    if (m) name = m[1].trim();
  }
  if (c.image) image = real(c.image);
  // Vocoder: bundled one, else the installed one named in dsconfig, else any compatible.
  let vocoder = null;
  const vy = await text('dsvocoder/vocoder.yaml');
  if (vy) {
    const vc = parseVocoderYaml(vy);
    vocoder = { config: vc, read: () => src.read(real('dsvocoder/' + vc.model)) };
  } else {
    vocoder = await findVocoder(ds.vocoder, ds);
  }
  const sessions = {};
  const emb = new Map();
  return {
    type: 'diffsinger',
    name,
    image,
    config: ds,
    phonemes,
    languages,
    dict,
    vocoder,
    speakers: ds.speakers || [],
    variance,
    async session(kind) {
      if (sessions[kind]) return sessions[kind];
      const ort = await getOrt();
      let bytes;
      if (kind === 'acoustic') {
        const r = real(ds.acoustic);
        if (!r) throw new Error('Acoustic model not found: ' + ds.acoustic);
        bytes = await src.read(r);
      } else if (kind === 'linguistic' || kind === 'variance') {
        const r = real(variance[kind]);
        if (!r) throw new Error('Variance model not found: ' + variance[kind]);
        bytes = await src.read(r);
      } else {
        if (!vocoder) throw new Error('No vocoder for this voice. Import a DiffSinger vocoder package (.oudep or .zip with vocoder.yaml).');
        bytes = await vocoder.read();
      }
      sessions[kind] = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      return sessions[kind];
    },
    async speakerEmbed(i) {
      const spk = (ds.speakers || [])[i] || (ds.speakers || [])[0];
      if (!spk) return null;
      if (emb.has(spk)) return emb.get(spk);
      const r = real(spk + '.emb');
      if (!r) throw new Error('Speaker file not found: ' + spk + '.emb');
      const b = await src.read(r);
      const v = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + ds.hiddenSize * 4));
      emb.set(spk, v);
      return v;
    },
    release() {
      for (const s of Object.values(sessions)) if (s && s.release) s.release();
    },
  };
}

// Phonemes of a note for a bank: phonetic hint, dictionary (typed text, kana, romaji),
// then Japanese kana rules. Unknown phonemes are dropped and reported.
export function phonemize(bank, note, report = () => {}) {
  const has = (p) => bank.phonemes.has(p);
  const fix = (p) => (has(p) ? p : has('ja/' + p) ? 'ja/' + p : null);
  if (note.lyric === 'br') return has('AP') ? ['AP'] : [];
  let list = null;
  if (note.ph) list = note.ph.split(/\s+/).filter(Boolean);
  const d = bank.dict.entries;
  if (!list) for (const k of [note.raw, note.raw && note.raw.toLowerCase(), note.lyric, kanaToRomaji(note.lyric)]) if (k && d.has(k)) { list = d.get(k); break; }
  if (!list) list = moraPhonemes(note.lyric);
  const out = [];
  for (const p of list) {
    const q = fix(p) || (p === 'N' ? fix('n') : null) || (p === 'cl' ? fix('cl') || fix('q') : null);
    if (q) out.push(q);
    else report(p);
  }
  return out;
}

export function isVowelFor(bank) {
  return (p) => {
    const t = bank.dict.types.get(p) || bank.dict.types.get(p.replace(/^[a-z]{2}\//, ''));
    if (t) return t === 'vowel';
    return /^(?:[a-z]{2}\/)?(a|i|u|e|o|N|SP|AP)$/.test(p);
  };
}

const tensor = (ort, type, data, dims) => new ort.Tensor(type, data, dims);
const i64 = (arr) => BigInt64Array.from(arr.map((x) => BigInt(Math.round(x))));

// Renders a phrase. ctx: { bank, pitch(t) MIDI, dyn(t) %, gen(t), steps, speaker, sr }.
// Returns { data, missing, notes } where notes lists approximations made.
// Word divisions of padded segments (OpenUtau WordDivAndDur): a word starts on each
// vowel; the head, the phonemes before the first vowel and the tail are words too.
export function wordDivAndDur(padded, phDur, isVowel) {
  let vowels = padded.map((p, i) => (!p.pad && isVowel(p.ph) ? i : -1)).filter((i) => i >= 0);
  if (!vowels.length) vowels = [padded.length - 2];
  const tail = padded.length - 1;
  const div = [vowels[0]];
  for (let k = 1; k < vowels.length; k++) div.push(vowels[k] - vowels[k - 1]);
  div.push(tail - vowels[vowels.length - 1], 1);
  const dur = [];
  let o = 0;
  for (const n of div) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += phDur[o + j];
    dur.push(sum);
    o += n;
  }
  return { div, dur };
}

// Runs a session, giving scalar inputs (speedup, steps, depth) the shape the model
// was exported with ([1] in some exports, a plain scalar in others).
async function runFlexible(ort, session, feeds) {
  try {
    return await session.run(feeds);
  } catch {
    const again = { ...feeds };
    for (const k of ['speedup', 'steps', 'depth']) if (again[k]) again[k] = tensor(ort, again[k].type, again[k].data, again[k].dims.length ? [] : [1]);
    return session.run(again);
  }
}

// Energy, breathiness, voicing and tension predicted by the variance model of the bank.
async function predictVariance(ort, bank, padded, durations, midiFrames) {
  const v = bank.variance;
  const ling = await bank.session('linguistic');
  const vari = await bank.session('variance');
  const sp = v.phonemes.has('SP') ? 'SP' : [...v.phonemes.keys()][0];
  const tokens = padded.map((p) => v.phonemes.get(p.pad ? sp : p.ph) ?? v.phonemes.get(sp) ?? 0);
  const T = midiFrames.length;
  const lf = { tokens: tensor(ort, 'int64', i64(tokens), [1, tokens.length]) };
  const lnames = new Set(ling.inputNames);
  if (lnames.has('word_div')) {
    const { div, dur } = wordDivAndDur(padded, durations, isVowelFor(bank));
    lf.word_div = tensor(ort, 'int64', i64(div), [1, div.length]);
    lf.word_dur = tensor(ort, 'int64', i64(dur), [1, dur.length]);
  }
  if (lnames.has('ph_dur')) lf.ph_dur = tensor(ort, 'int64', i64(durations), [1, durations.length]);
  const lout = await ling.run(lf);
  const encoder = lout.encoder_out || lout[ling.outputNames[0]];
  const vnames = vari.inputNames;
  const kinds = ['energy', 'breathiness', 'voicing', 'tension'].filter((k) => vnames.includes(k));
  const vf = {
    encoder_out: encoder,
    ph_dur: tensor(ort, 'int64', i64(durations), [1, durations.length]),
    pitch: tensor(ort, 'float32', midiFrames, [1, T]),
  };
  for (const k of kinds) vf[k] = tensor(ort, 'float32', new Float32Array(T), [1, T]);
  if (vnames.includes('retake')) vf.retake = tensor(ort, 'bool', new Uint8Array(T * kinds.length).fill(1), [1, T, kinds.length]);
  if (vnames.includes('speedup')) vf.speedup = tensor(ort, 'int64', i64([100]), []);
  if (vnames.includes('steps')) vf.steps = tensor(ort, 'int64', i64([10]), [1]);
  for (const n of vnames) if (!vf[n]) throw new Error('The variance model needs an input this app does not provide: ' + n);
  const out = await runFlexible(ort, vari, vf);
  const res = {};
  for (const k of kinds) {
    const t = out[k + '_pred'];
    if (t) res[k] = Float32Array.from(t.data);
  }
  return res;
}

export async function renderDiffSinger(phrase, { bank, pitch, dyn, gen, bre = () => 0, ten = () => 0, steps = 20, speaker = 0, sr = 44100 }) {
  const ort = await getOrt();
  const ds = bank.config;
  const vc = bank.vocoder && bank.vocoder.config;
  if (!vc) throw new Error('No vocoder for this voice. Import a DiffSinger vocoder package (.oudep or .zip with vocoder.yaml).');
  const bad = checkVocoder(ds, vc);
  if (bad.length) throw new Error('The vocoder does not match the voice (' + bad.join(', ') + ').');
  const missing = [];
  const info = [];
  const isVowel = isVowelFor(bank);
  const segs = timeline(phrase.notes, (n) => phonemize(bank, n, (p) => missing.push(p)), isVowel);
  const len = Math.ceil((phrase.end - phrase.start) * sr);
  const out = new Float32Array(len);
  if (!segs.length) return { data: out, missing, info };
  const frameMs = (1000 * ds.hopSize) / ds.sampleRate;
  const frameSec = frameMs / 1000;
  // Padded segments: SP head, phonemes with SP in the gaps, SP tail.
  const padded = [{ ph: 'SP', ms: HEAD * frameMs, pad: true }];
  segs.forEach((s, i) => {
    if (i > 0) {
      const gap = s.start - segs[i - 1].end;
      if (gap > 1e-4) padded.push({ ph: 'SP', ms: gap * 1000, pad: true });
    }
    padded.push({ ph: s.ph, ms: (s.end - s.start) * 1000 });
  });
  padded.push({ ph: 'SP', ms: TAIL * frameMs, pad: true });
  const sp = bank.phonemes.has('SP') ? 'SP' : bank.phonemes.has('pau') ? 'pau' : [...bank.phonemes.keys()][0];
  const tokens = padded.map((p) => bank.phonemes.get(p.ph === 'SP' ? sp : p.ph) ?? 0);
  const durations = msToFrames(padded.map((p) => p.ms), frameMs);
  const total = durations.reduce((a, b) => a + b, 0);
  const t0 = segs[0].start - HEAD * frameSec;
  const f0 = new Float32Array(total);
  for (let i = 0; i < total; i++) f0[i] = midiToHz(pitch(t0 + i * frameSec));
  const acoustic = await bank.session('acoustic');
  const names = new Set(acoustic.inputNames);
  const feeds = {
    tokens: tensor(ort, 'int64', i64(tokens), [1, tokens.length]),
    durations: tensor(ort, 'int64', i64(durations), [1, durations.length]),
    f0: tensor(ort, 'float32', f0, [1, total]),
  };
  const depth = ds.useVariableDepth ? Math.min(1, Math.max(0, ds.maxDepth)) : 1;
  if (ds.useContinuousAcceleration) {
    if (ds.useVariableDepth) feeds.depth = tensor(ort, 'float32', new Float32Array([depth]), [1]);
    feeds.steps = tensor(ort, 'int64', i64([steps]), [1]);
  } else {
    let speedup;
    if (ds.useVariableDepth) {
      let d64 = Math.round(depth * 1000);
      speedup = Math.max(1, Math.floor(d64 / steps));
      d64 = Math.floor(d64 / speedup) * speedup;
      feeds.depth = tensor(ort, 'int64', i64([d64]), [1]);
    } else {
      speedup = Math.max(1, Math.floor(1000 / steps));
      while (1000 % speedup !== 0 && speedup > 1) speedup--;
    }
    feeds.speedup = tensor(ort, 'int64', i64([speedup]), [1]);
  }
  if (names.has('languages')) {
    const ids = padded.map((p) => {
      const m = /^([a-z]{2})\//.exec(p.ph);
      return m && bank.languages ? bank.languages.get(m[1]) || 0 : 0;
    });
    feeds.languages = tensor(ort, 'int64', i64(ids), [1, ids.length]);
  }
  if (names.has('spk_embed')) {
    const e = await bank.speakerEmbed(speaker);
    const H = ds.hiddenSize;
    const arr = new Float32Array(total * H);
    if (e) for (let i = 0; i < total; i++) arr.set(e.subarray(0, H), i * H);
    feeds.spk_embed = tensor(ort, 'float32', arr, [1, total, H]);
  }
  if (names.has('gender')) {
    const [lo, hi] = ds.keyShiftRange;
    const pos = hi === 0 ? 0 : 12 / hi / 100;
    const neg = lo === 0 ? 0 : -12 / lo / 100;
    const g = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const x = gen(t0 + i * frameSec);
      g[i] = x < 0 ? -x * pos : -x * neg;
    }
    feeds.gender = tensor(ort, 'float32', g, [1, total]);
  }
  if (names.has('velocity')) feeds.velocity = tensor(ort, 'float32', new Float32Array(total).fill(1), [1, total]);
  // Energy, breathiness, voicing, tension: predicted by the variance model of the bank
  // (plus the user curves, as in OpenUtau), or neutral values when the bank has none.
  const needed = ['energy', 'breathiness', 'voicing', 'tension'].filter((k) => names.has(k));
  if (needed.length) {
    let pred = {};
    if (bank.variance) {
      const midi = new Float32Array(total);
      for (let i = 0; i < total; i++) midi[i] = pitch(t0 + i * frameSec);
      pred = await predictVariance(ort, bank, padded, durations, midi);
    }
    const neutral = { energy: -20, breathiness: -60, voicing: -10, tension: 0 };
    for (const k of needed) {
      const arr = new Float32Array(total);
      for (let i = 0; i < total; i++) {
        const t = t0 + i * frameSec;
        const base = pred[k] ? pred[k][i] : neutral[k];
        if (k === 'breathiness') arr[i] = Math.max(-96, Math.min(0, base + (bre(t) * 12) / 100));
        else if (k === 'tension') arr[i] = Math.max(-10, Math.min(10, base + ten(t) / 20));
        else arr[i] = Math.max(-96, Math.min(0, base));
      }
      feeds[k] = tensor(ort, 'float32', arr, [1, total]);
      if (!pred[k]) info.push(k);
    }
  }
  const run = {};
  for (const n of acoustic.inputNames) {
    if (!feeds[n]) throw new Error('The acoustic model needs an input this app does not provide: ' + n);
    run[n] = feeds[n];
  }
  const res = await runFlexible(ort, acoustic, run);
  const mel = res[acoustic.outputNames[0]];
  let melData = mel.data;
  if (vc.melBase !== ds.melBase) {
    const k = vc.melBase === 'e' && ds.melBase === '10' ? 2.30259 : 0.434294;
    melData = Float32Array.from(melData, (x) => x * k);
  }
  const vocoder = await bank.session('vocoder');
  const vfeeds = {};
  for (const n of vocoder.inputNames) {
    if (n === 'mel') vfeeds.mel = tensor(ort, 'float32', melData, mel.dims);
    else if (n === 'f0') vfeeds.f0 = tensor(ort, 'float32', f0, [1, total]);
    else throw new Error('The vocoder needs an unknown input: ' + n);
  }
  const vres = await vocoder.run(vfeeds);
  let wave = vres[vocoder.outputNames[0]].data;
  if (vc.sampleRate !== sr) wave = resample(wave, vc.sampleRate, sr);
  const base = Math.round((t0 - phrase.start) * sr);
  for (let i = 0; i < wave.length; i++) {
    const o = base + i;
    if (o < 0 || o >= len) continue;
    out[o] = wave[i] * (dyn(phrase.start + o / sr) / 100);
  }
  return { data: out, missing, info };
}
