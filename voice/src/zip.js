// Archives of voicebanks: ZIP (and .oudep, which is a ZIP). UTAU banks are often made
// on Japanese Windows, so file names and texts may be in Shift-JIS.
import { unzipSync } from 'fflate';

// Text of a file: UTF-8 when valid (BOM removed), otherwise Shift-JIS.
export function decodeText(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, '');
  } catch {
    try {
      return new TextDecoder('shift_jis').decode(u8);
    } catch {
      return new TextDecoder('latin1').decode(u8);
    }
  }
}

// fflate gives names without the UTF-8 flag as latin1: decode their bytes again.
function fixName(name) {
  if (!/[\x80-\xff]/.test(name)) return name;
  const bytes = new Uint8Array([...name].map((c) => c.charCodeAt(0) & 255));
  return decodeText(bytes);
}

// Lists and extracts a ZIP: { names: [...], read(name) -> Uint8Array }. Files are
// decompressed one at a time, so a big voicebank does not fill the memory at once.
export function openZip(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const raw = new Map();
  unzipSync(u8, {
    filter: (f) => {
      if (!f.name.endsWith('/')) raw.set(fixName(f.name).replace(/\\/g, '/'), f.name);
      return false;
    },
  });
  return {
    names: [...raw.keys()],
    read(name) {
      const r = raw.get(name);
      if (r == null) return null;
      const got = unzipSync(u8, { filter: (f) => f.name === r });
      return got[r] || null;
    },
  };
}

// ZIP read straight from a File or Blob: only the central directory and one entry at a
// time are in memory (voicebanks can be hundreds of MB). ZIP64 is supported.
export async function openZipBlob(blob) {
  const { inflateSync } = await import('fflate');
  const bytes = async (a, b) => new Uint8Array(await blob.slice(a, b).arrayBuffer());
  const size = blob.size;
  const tailLen = Math.min(size, 65557);
  const tail = await bytes(size - tailLen, size);
  const dv = new DataView(tail.buffer);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      e = i;
      break;
    }
  }
  if (e < 0) throw new Error('Not a ZIP file');
  let count = dv.getUint16(e + 10, true);
  let cdSize = dv.getUint32(e + 12, true);
  let cdOff = dv.getUint32(e + 16, true);
  if (cdOff === 0xffffffff || cdSize === 0xffffffff || count === 0xffff) {
    const loc = e - 20;
    if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
      const z64 = Number(dv.getBigUint64(loc + 8, true));
      const rec = await bytes(z64, z64 + 56);
      const rv = new DataView(rec.buffer);
      if (rv.getUint32(0, true) !== 0x06064b50) throw new Error('Damaged ZIP64 file');
      count = Number(rv.getBigUint64(32, true));
      cdSize = Number(rv.getBigUint64(40, true));
      cdOff = Number(rv.getBigUint64(48, true));
    }
  }
  const cd = await bytes(cdOff, cdOff + cdSize);
  const cv = new DataView(cd.buffer);
  const entries = new Map();
  let p = 0;
  for (let k = 0; k < count && p + 46 <= cd.length; k++) {
    if (cv.getUint32(p, true) !== 0x02014b50) break;
    const flags = cv.getUint16(p + 8, true);
    const method = cv.getUint16(p + 10, true);
    let comp = cv.getUint32(p + 20, true);
    let raw = cv.getUint32(p + 24, true);
    const nl = cv.getUint16(p + 28, true);
    const xl = cv.getUint16(p + 30, true);
    const cl = cv.getUint16(p + 32, true);
    let off = cv.getUint32(p + 42, true);
    const nameBytes = cd.subarray(p + 46, p + 46 + nl);
    let x = p + 46 + nl;
    const xEnd = x + xl;
    while (x + 4 <= xEnd) {
      const id = cv.getUint16(x, true);
      const len = cv.getUint16(x + 2, true);
      if (id === 0x0001) {
        let q = x + 4;
        if (raw === 0xffffffff) { raw = Number(cv.getBigUint64(q, true)); q += 8; }
        if (comp === 0xffffffff) { comp = Number(cv.getBigUint64(q, true)); q += 8; }
        if (off === 0xffffffff) { off = Number(cv.getBigUint64(q, true)); }
      }
      x += 4 + len;
    }
    const name = (flags & 0x800 ? new TextDecoder().decode(nameBytes) : decodeText(nameBytes)).replace(/\\/g, '/');
    if (!name.endsWith('/')) entries.set(name, { method, comp, raw, off });
    p += 46 + nl + xl + cl;
  }
  return {
    names: [...entries.keys()],
    async read(name) {
      const en = entries.get(name);
      if (!en) return null;
      const lh = await bytes(en.off, en.off + 30);
      const lv = new DataView(lh.buffer);
      if (lv.getUint32(0, true) !== 0x04034b50) throw new Error('Damaged ZIP file: ' + name);
      const start = en.off + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
      const data = await bytes(start, start + en.comp);
      if (en.method === 0) return data;
      if (en.method === 8) return inflateSync(data, { out: new Uint8Array(en.raw) });
      throw new Error('Unsupported ZIP compression in ' + name);
    },
  };
}
