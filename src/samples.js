import { unzipSync } from 'fflate';
import { unrarFiles } from './rar.js';
import { t } from './i18n.js';

// Imported samples live in IndexedDB on the device. Nothing is uploaded.
const DB_NAME = 'astudio';
const STORE = 'samples';
const AUDIO_EXT = /\.(wav|wave|mp3|ogg|oga|flac|m4a|aac|aif|aiff|opus|webm)$/i;

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let result;
        Promise.resolve(fn(store)).then((r) => {
          result = r;
        });
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

const reqP = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

// In memory: metadata of every sample, decoded buffers, waveform peaks.
const meta = new Map();
const buffers = new Map();
const decoding = new Map();
const peaks = new Map();
const listeners = new Set();
let decodeCtx = null;

export const onSamplesChange = (fn) => listeners.add(fn);
const changed = () => listeners.forEach((fn) => fn());

export function listSamples() {
  return [...meta.values()].sort((a, b) => (a.folder + '/' + a.name).localeCompare(b.folder + '/' + b.name, 'fr'));
}

export const getSampleMeta = (id) => meta.get(id) || null;
export const getBuffer = (id) => buffers.get(id) || null;

export async function initSamples() {
  try {
    const all = await tx('readonly', (s) => reqP(s.getAll()));
    for (const r of all || []) meta.set(r.id, { id: r.id, name: r.name, folder: r.folder, size: r.size, duration: r.duration || 0 });
    changed();
  } catch {
    /* IndexedDB unavailable: samples simply stay empty */
  }
}

function ctxForDecode() {
  if (!decodeCtx) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    decodeCtx = new OAC(2, 1, 44100);
  }
  return decodeCtx;
}

// Decode a stored sample (once). Resolves to the AudioBuffer or null.
export function loadBuffer(id) {
  if (buffers.has(id)) return Promise.resolve(buffers.get(id));
  if (decoding.has(id)) return decoding.get(id);
  const p = tx('readonly', (s) => reqP(s.get(id)))
    .then((rec) => (rec ? ctxForDecode().decodeAudioData(rec.bytes.slice(0)) : null))
    .then((buf) => {
      if (buf) {
        buffers.set(id, buf);
        changed();
      }
      decoding.delete(id);
      return buf;
    })
    .catch(() => {
      decoding.delete(id);
      return null;
    });
  decoding.set(id, p);
  return p;
}

export function waveform(id, n = 200) {
  const key = id + ':' + n;
  if (peaks.has(key)) return peaks.get(key);
  const buf = buffers.get(id);
  if (!buf) return null;
  const d = buf.getChannelData(0);
  const out = new Float32Array(n);
  const step = Math.max(1, Math.floor(d.length / n));
  for (let i = 0; i < n; i++) {
    let m = 0;
    const end = Math.min(d.length, (i + 1) * step);
    for (let j = i * step; j < end; j += 4) m = Math.max(m, Math.abs(d[j]));
    out[i] = m;
  }
  peaks.set(key, out);
  return out;
}

const newSampleId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function addOne(name, folder, bytes) {
  const buf = await ctxForDecode().decodeAudioData(bytes.slice(0));
  const rec = { id: newSampleId(), name, folder, size: bytes.byteLength, duration: buf.duration, bytes, addedAt: Date.now() };
  await tx('readwrite', (s) => reqP(s.put(rec)));
  meta.set(rec.id, { id: rec.id, name, folder, size: rec.size, duration: buf.duration });
  buffers.set(rec.id, buf);
  return rec.id;
}

// Raw stored sample (for the project ZIP export). Resolves to { id, name, folder, bytes } or null.
export async function getSampleRecord(id) {
  try {
    const rec = await tx('readonly', (st) => reqP(st.get(id)));
    return rec ? { id: rec.id, name: rec.name, folder: rec.folder, bytes: rec.bytes } : null;
  } catch {
    return null;
  }
}

// Store a sample under a given id (project ZIP import). Skips ids already on the device.
export async function putSampleWithId(id, name, folder, bytes) {
  if (meta.has(id)) return false;
  const buf = await ctxForDecode().decodeAudioData(bytes.slice(0));
  const rec = { id, name, folder, size: bytes.byteLength, duration: buf.duration, bytes, addedAt: Date.now() };
  await tx('readwrite', (st) => reqP(st.put(rec)));
  meta.set(id, { id, name, folder, size: rec.size, duration: buf.duration });
  buffers.set(id, buf);
  changed();
  return true;
}

// Store recorded or generated audio as a sample. Returns its id.
export async function addSample(name, folder, bytes) {
  const id = await addOne(name, folder, bytes);
  changed();
  return id;
}

const baseName = (p) => p.split('/').pop();
const stripExt = (n) => n.replace(/\.[^.]+$/, '');

// Import files picked by the user: audio files and ZIP or RAR sample packs.
// Returns { added, skipped }.
export async function importFiles(files, onProgress) {
  let added = 0;
  let skipped = 0;
  for (const f of files) {
    const bytes = await f.arrayBuffer();
    if (/\.(zip|rar)$/i.test(f.name)) {
      const pack = stripExt(f.name);
      const keep = (name) => AUDIO_EXT.test(name) && !name.includes('__MACOSX') && !baseName(name).startsWith('.');
      let entries;
      try {
        entries = /\.rar$/i.test(f.name)
          ? await unrarFiles(bytes, keep)
          : unzipSync(new Uint8Array(bytes), { filter: (file) => keep(file.name) });
      } catch (e) {
        if (e && e.reason === 'ERAR_MISSING_PASSWORD') throw new Error(t('This RAR archive is protected by a password.'));
        console.warn('Archive not readable:', f.name, e);
        skipped += 1;
        continue;
      }
      const names = Object.keys(entries);
      for (let i = 0; i < names.length; i++) {
        const path = names[i];
        const parts = path.split('/').filter(Boolean);
        const file = parts.pop();
        if (parts[0] && parts[0].toLowerCase() === pack.toLowerCase()) parts.shift();
        const folder = [pack, ...parts].join('/');
        const u8 = entries[path];
        try {
          await addOne(stripExt(file), folder, u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
          added += 1;
        } catch {
          skipped += 1;
        }
        onProgress && onProgress(added + skipped, names.length);
      }
    } else if (AUDIO_EXT.test(f.name) || (f.type && f.type.startsWith('audio/'))) {
      try {
        await addOne(stripExt(f.name), t('Imported'), bytes);
        added += 1;
      } catch {
        skipped += 1;
      }
      onProgress && onProgress(added + skipped, files.length);
    } else skipped += 1;
  }
  changed();
  return { added, skipped };
}

export async function deleteSamples(ids) {
  await tx('readwrite', (s) => {
    for (const id of ids) s.delete(id);
  });
  for (const id of ids) {
    meta.delete(id);
    buffers.delete(id);
  }
  changed();
}
