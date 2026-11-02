import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export const isNative = () => Capacitor.isNativePlatform();

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}

// Save a file. On Android it goes through the system share sheet so the user
// chooses where it goes. In a browser it is downloaded.
export async function saveFile(name, data, mime) {
  if (isNative()) {
    const text = typeof data === 'string';
    const res = await Filesystem.writeFile({
      path: name,
      data: text ? data : toBase64(data),
      directory: Directory.Cache,
      encoding: text ? Encoding.UTF8 : undefined,
    });
    try {
      await Share.share({ title: name, files: [res.uri] });
    } catch (e) {
      if (!/cancel/i.test(String(e && e.message))) throw e;
    }
    return;
  }
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Pick a file and read it as bytes. Resolves to { name, bytes } or null.
export function pickBinary(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve({ name: f.name, bytes: new Uint8Array(r.result) });
      r.onerror = () => resolve(null);
      r.readAsArrayBuffer(f);
    });
    input.click();
  });
}

export function pickFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsText(f);
    });
    input.click();
  });
}
