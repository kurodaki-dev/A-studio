// Link with A Studio: the switch at the top goes back to A Studio, and a rendered song
// can be sent to A Studio as a sample.
//
// - Android: A Voice Studio is a separate extension app. The ExtensionBridge native
//   plugin opens A Studio; a song is saved to Documents/A Voice Studio and shared.
// - Web: both apps live on the same site, A Studio at "../". A song goes straight into
//   A Studio's sample library (same browser storage), folder "A Voice Studio".
import { Capacitor, registerPlugin } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();
const Bridge = registerPlugin('ExtensionBridge');
export const STUDIO_PACKAGE = 'com.kurodaki.astudio';

export async function openStudio() {
  if (isNative()) {
    try {
      await Bridge.openApp({ package: STUDIO_PACKAGE, uri: 'astudio://open' });
      return true;
    } catch {
      window.location.href = 'astudio://open';
      return true;
    }
  }
  window.location.href = new URL('../', window.location.href).href;
  return true;
}

// Web: writes a WAV into A Studio's IndexedDB sample store (database "astudio").
function putStudioSample(name, bytes, duration) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('astudio', 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('samples')) r.result.createObjectStore('samples', { keyPath: 'id' });
    };
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const d = r.result;
      const t = d.transaction('samples', 'readwrite');
      const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      t.objectStore('samples').put({ id, name, folder: 'A Voice Studio', size: buf.byteLength, duration, bytes: buf, addedAt: Date.now() });
      t.oncomplete = () => { d.close(); resolve(id); };
      t.onerror = () => reject(t.error);
    };
  });
}

function base64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// Saves a file on the device (Android: Documents/A Voice Studio) or downloads it (web).
export async function saveFile(name, bytes, mime) {
  if (isNative()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const path = 'A Voice Studio/' + name;
    await Filesystem.writeFile({ path, data: base64(bytes), directory: Directory.Documents, recursive: true });
    return { where: 'Documents/' + path };
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { where: 'download' };
}

// Sends a rendered WAV to A Studio. Returns a short description of what happened.
export async function sendToStudio(name, bytes, duration) {
  if (isNative()) {
    const saved = await saveFile(name, bytes, 'audio/wav');
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
      const { uri } = await Filesystem.getUri({ path: 'A Voice Studio/' + name, directory: Directory.Documents });
      await Share.share({ title: name, files: [uri] });
    } catch {
      /* sharing cancelled: the file stays saved */
    }
    return { mode: 'file', where: saved.where };
  }
  await putStudioSample(name.replace(/\.wav$/i, ''), bytes, duration);
  return { mode: 'library' };
}
