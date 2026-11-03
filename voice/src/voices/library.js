// Voice library: imported voicebanks (UTAU, DiffSinger), DiffSinger vocoders, humanizer
// models and VOICEVOX engine voices. Files are kept in IndexedDB on the device.
import YAML from 'yaml';
import { openZip, decodeText } from '../zip.js';
import { loadUtau } from './utau.js';
import { loadDiffSinger, parseVocoderYaml, checkVocoder } from './diffsinger.js';
import { listSingers, teacherOf, cleanUrl } from './voicevox.js';
import { BUILTIN_VOICES } from './builtin.js';

const DB = 'a-voice-studio';
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('voices')) d.createObjectStore('voices', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage full or blocked'));
  });
}
const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

// Key/value storage (settings, projects, themes, plugins).
export const kv = {
  get: (k) => tx('kv', 'readonly', (s) => req(s.get(k))),
  set: (k, v) => tx('kv', 'readwrite', (s) => { s.put(v, k); }),
  del: (k) => tx('kv', 'readwrite', (s) => { s.delete(k); }),
  keys: () => tx('kv', 'readonly', (s) => req(s.getAllKeys())),
};

const SUB = /(^|\/)(dsdur|dsvariance|dspitch|dsvocoder)\/[^/]*$/i;
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

// What an archive holds: [{ type: 'diffsinger'|'utau'|'vocoder'|'humanizer', root }].
export function detectBanks(names) {
  const found = [];
  const dsRoots = names.filter((n) => /(^|\/)dsconfig\.yaml$/i.test(n) && !SUB.test(n)).map(dirOf);
  for (const r of dsRoots) found.push({ type: 'diffsinger', root: r });
  const inDs = (n) => dsRoots.some((r) => (r ? n.startsWith(r + '/') : true));
  for (const n of names) if (/(^|\/)vocoder\.yaml$/i.test(n) && !inDs(n)) found.push({ type: 'vocoder', root: dirOf(n) });
  const otoDirs = [...new Set(names.filter((n) => /(^|\/)oto\.ini$/i.test(n) && !inDs(n)).map(dirOf))];
  const utauRoots = [];
  for (const d of otoDirs.sort((a, b) => a.length - b.length)) {
    if (utauRoots.some((r) => (r ? d.startsWith(r + '/') : true))) continue;
    // A bank with pitch folders keeps character.txt at its top: use that folder.
    const parts = d.split('/');
    let root = d;
    for (let k = parts.length - 1; k >= 0; k--) {
      const cand = parts.slice(0, k).join('/');
      if (names.some((n) => n.toLowerCase() === ((cand ? cand + '/' : '') + 'character.txt').toLowerCase())) root = cand;
    }
    if (!utauRoots.includes(root)) utauRoots.push(root);
  }
  for (const r of utauRoots) found.push({ type: 'utau', root: r });
  if (!found.length) {
    const onnx = names.filter((n) => /\.onnx$/i.test(n));
    if (onnx.length === 1) found.push({ type: 'humanizer', root: dirOf(onnx[0]), file: onnx[0] });
  }
  return found;
}

export async function listVoices() {
  const stored = await tx('voices', 'readonly', (s) => req(s.getAll()));
  return stored.sort((a, b) => (a.added || 0) - (b.added || 0));
}
export async function getVoice(id) {
  if (id && id.startsWith('builtin:')) return BUILTIN_VOICES.find((v) => v.id === id) ? { id, type: 'builtin', name: BUILTIN_VOICES.find((v) => v.id === id).name } : null;
  return tx('voices', 'readonly', (s) => req(s.get(id)));
}
export async function readFile(id, path) {
  const v = await tx('files', 'readonly', (s) => req(s.get(id + '::' + path)));
  if (v == null) throw new Error('File missing in the library: ' + path);
  return v instanceof Uint8Array ? v : new Uint8Array(await (v.arrayBuffer ? v.arrayBuffer() : v));
}
export async function removeVoice(id) {
  const v = await getVoice(id);
  if (!v) return;
  await tx('files', 'readwrite', (s) => { for (const f of v.files || []) s.delete(id + '::' + f); });
  await tx('voices', 'readwrite', (s) => { s.delete(id); });
  banks.delete(id);
}

export function sourceOf(v) {
  return { names: v.files || [], read: (p) => readFile(v.id, p) };
}

const newVoiceId = (type) => type + ':' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Imports an archive (ZIP or .oudep) or a single model file. Returns the voices added.
export async function importArchive(fileName, bytes, onProgress = () => {}) {
  let names;
  let read;
  if (/\.onnx$/i.test(fileName)) {
    names = [fileName];
    read = () => bytes;
  } else {
    const zip = openZip(bytes);
    names = zip.names;
    read = (n) => zip.read(n);
  }
  const banksFound = detectBanks(names);
  if (!banksFound.length) throw new Error('No voicebank found: a UTAU bank has an oto.ini, a DiffSinger bank a dsconfig.yaml, a vocoder a vocoder.yaml.');
  const zipSrc = { names, read: async (n) => read(n) };
  const added = [];
  for (const b of banksFound) {
    const pre = b.root ? b.root + '/' : '';
    const files = names.filter((n) => n.startsWith(pre) && !/(^|\/)__MACOSX\//.test(n) && !/(^|\/)\.[^/]*$/.test(n));
    const id = newVoiceId(b.type);
    let name = b.root.split('/').pop() || fileName.replace(/\.[^.]+$/, '');
    let image = null;
    let extra = {};
    if (b.type === 'utau') {
      const bank = await loadUtau(zipSrc, b.root);
      name = bank.name;
      image = bank.image;
      extra = { aliases: bank.entries.size };
    } else if (b.type === 'diffsinger') {
      const bank = await loadDiffSinger(zipSrc, b.root, async () => null);
      name = bank.name;
      image = bank.image;
      extra = { speakers: bank.speakers, bundledVocoder: !!bank.vocoder, vocoderName: bank.config.vocoder || '' };
    } else if (b.type === 'vocoder') {
      const y = names.find((n) => n.toLowerCase() === (pre + 'vocoder.yaml').toLowerCase());
      const vc = parseVocoderYaml(decodeText(read(y)));
      name = vc.name || name;
      extra = { vocoder: vc };
    } else if (b.type === 'humanizer') {
      extra = { model: b.file };
      name = b.file.split('/').pop().replace(/\.onnx$/i, '');
    }
    let size = 0;
    for (let i = 0; i < files.length; i++) {
      const data = read(files[i]);
      size += data.length;
      await tx('files', 'readwrite', (s) => { s.put(data, id + '::' + files[i]); });
      onProgress(i + 1, files.length, name);
    }
    const rec = { id, type: b.type, name, root: b.root, files, image, size, added: Date.now(), ...extra };
    await tx('voices', 'readwrite', (s) => { s.put(rec); });
    added.push(rec);
  }
  return added;
}

// VOICEVOX: adds every singing style of an engine as a voice.
export async function addVoicevoxEngine(url) {
  const base = cleanUrl(url);
  const singers = await listSingers(base);
  const teacher = teacherOf(singers);
  const added = [];
  for (const s of singers) {
    for (const st of s.styles) {
      if (st.type === 'singing_teacher') continue;
      const rec = { id: 'voicevox:' + base + '#' + st.id, type: 'voicevox', name: s.name + ' (' + st.name + ')', url: base, speaker: st.id, teacher, files: [], added: Date.now() };
      await tx('voices', 'readwrite', (x) => { x.put(rec); });
      added.push(rec);
    }
  }
  if (!added.length) throw new Error('This engine has no singing voice. VOICEVOX 0.16 or newer is needed for singing.');
  return added;
}

// Loaded banks (parsed, with their caches), by voice id.
const banks = new Map();
export async function loadBank(v) {
  if (banks.has(v.id)) return banks.get(v.id);
  let bank;
  if (v.type === 'utau') bank = await loadUtau(sourceOf(v), v.root);
  else if (v.type === 'diffsinger') bank = await loadDiffSinger(sourceOf(v), v.root, findVocoder);
  else throw new Error('Not a voicebank: ' + v.type);
  banks.set(v.id, bank);
  return bank;
}
export function forgetBanks() {
  for (const b of banks.values()) if (b.release) b.release();
  banks.clear();
}

// Installed vocoder for a DiffSinger bank: by name, else any one that matches.
export async function findVocoder(name, ds) {
  const all = (await listVoices()).filter((v) => v.type === 'vocoder');
  const ok = all.filter((v) => !checkVocoder(ds, v.vocoder).length);
  const pick = ok.find((v) => name && (v.name === name || v.root.split('/').pop() === name)) || ok[0];
  if (!pick) return null;
  const pre = pick.root ? pick.root + '/' : '';
  return { config: pick.vocoder, read: () => readFile(pick.id, pre + pick.vocoder.model) };
}

export function voiceImage(v) {
  return v && v.image ? readFile(v.id, v.image).then((b) => URL.createObjectURL(new Blob([b]))).catch(() => null) : Promise.resolve(null);
}

export const parseYaml = (t) => YAML.parse(t);

// The DiffSinger community vocoder of OpenVPI (PC-NSF-HiFiGAN, 44.1 kHz, hop 512,
// 128 mel bins: the one most DiffSinger voices use), downloaded on demand.
// Licence: CC BY-NC-SA 4.0 (OpenVPI), non commercial use.
export const COMMUNITY_VOCODER = {
  name: 'pc_nsf_hifigan_44.1k_hop512_128bin_2025.02',
  base: 'https://huggingface.co/DanielMarius/dms-pc-nsf-hifigan-44-1k-hop512-128bin-2025-02/resolve/main/',
  files: ['vocoder.yaml', 'pc_nsf_hifigan_44.1k_hop512_128bin_2025.02.onnx', 'NOTICE.txt'],
  size: 56616643,
};

async function fetchBytes(url, onBytes) {
  const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error('Download failed: HTTP ' + res.status);
  if (!res.body || !res.body.getReader) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onBytes(got);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export async function hasVocoder() {
  return (await listVoices()).some((v) => v.type === 'vocoder');
}

// Downloads the community vocoder into the library. onProgress(received, total).
export async function downloadCommunityVocoder(onProgress = () => {}) {
  const v = COMMUNITY_VOCODER;
  const id = newVoiceId('vocoder');
  const files = [];
  let done = 0;
  for (const f of v.files) {
    const data = await fetchBytes(v.base + f, (n) => onProgress(done + n, v.size));
    done += data.length;
    const path = v.name + '/' + f;
    await tx('files', 'readwrite', (s) => { s.put(data, id + '::' + path); });
    files.push(path);
  }
  const vc = parseVocoderYaml(decodeText(await readFile(id, v.name + '/vocoder.yaml')));
  const rec = { id, type: 'vocoder', name: vc.name || v.name, root: v.name, files, image: null, size: done, added: Date.now(), vocoder: vc, licence: 'CC BY-NC-SA 4.0 (OpenVPI)' };
  await tx('voices', 'readwrite', (s) => { s.put(rec); });
  forgetBanks();
  return rec;
}
