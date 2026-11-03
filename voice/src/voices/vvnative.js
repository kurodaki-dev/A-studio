// Built-in VOICEVOX (Android): the official VOICEVOX CORE runs inside the app, through the
// VoicevoxCore native plugin (voicevox_core + the VOICEVOX build of ONNX Runtime). No
// engine to start anywhere. The singing voices (s0.vvm, 130 MB) and the Open JTalk
// dictionary (22 MB) are downloaded once, from their official GitHub releases.
//
// The VOICEVOX voice models are in a protected format that only the official runtime can
// read, so this cannot run in a web page: on the web the engine mode (an address of a
// VOICEVOX engine) stays available.
import { registerPlugin, Capacitor } from '@capacitor/core';

export const BUILTIN = 'builtin'; // value of `url` for voices run by the native plugin
export const TEACHER_STYLE = 6000; // singing teacher (timing, pitch, volume) of s0.vvm

let plugin = null;
const getPlugin = () => plugin || (plugin = registerPlugin('VoicevoxCore'));
export function setNativePlugin(p) {
  plugin = p;
}

export const nativeSupported = () => !!plugin || (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android');

// { runtime: bool, model: bool, dict: bool, ready: bool }
export async function nativeStatus() {
  if (!nativeSupported()) return { runtime: false, model: false, dict: false, ready: false };
  try {
    const s = await getPlugin().status();
    return { runtime: !!s.runtime, model: !!s.model, dict: !!s.dict, ready: !!(s.runtime && s.model && s.dict) };
  } catch {
    return { runtime: false, model: false, dict: false, ready: false };
  }
}

// Downloads what is missing. onProgress(received, total, label).
export async function nativeInstall(onProgress = () => {}) {
  const p = getPlugin();
  const sub = await p.addListener('progress', (e) => onProgress(Number(e.received) || 0, Number(e.total) || 0, String(e.what || '')));
  try {
    await p.install();
  } finally {
    if (sub && sub.remove) sub.remove();
  }
}

// Singing voices of the model: [{ name, uuid, styles: [{ name, id, type }] }].
export async function nativeSingers() {
  const r = await getPlugin().singers();
  return (r.singers || []).map((s) => ({
    name: String(s.name || ''),
    uuid: String(s.uuid || ''),
    styles: (s.styles || []).map((st) => ({ name: String(st.name || ''), id: Number(st.id), type: String(st.type || '') })),
  }));
}

// The engine's own timing, pitch and volume for a score ({ notes }), from the singing
// teacher. Returns { token, f0: number[], volume: number[] } (one value per frame).
export async function nativeQuery(score, teacher = TEACHER_STYLE) {
  const r = await getPlugin().query({ score: JSON.stringify(score), style: teacher });
  return { token: r.token, f0: r.f0 || [], volume: r.volume || [] };
}

// Audio of a query with our pitch and volume. Returns WAV bytes.
export async function nativeSynthesize(token, f0, volume, style) {
  const r = await getPlugin().synthesize({ token, f0, volume, style });
  const bin = atob(r.wav);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
