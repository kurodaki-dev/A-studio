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
