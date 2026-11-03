// VOICEVOX singing through a VOICEVOX engine (the free engine of voicevox.hiroshiba.jp,
// on this device's network or a computer). The engine makes the timing and timbre;
// A Voice Studio sends the notes, then replaces the pitch with its own curve.
import { decodeWav, resample } from '../dsp.js';
import { toKatakana } from '../lyrics.js';
import { midiToHz } from '../phrase.js';

export const VV_FPS = 93.75; // frames per second of the engine (24000 / 256)
export const DEFAULT_ENGINE = 'http://localhost:50021';

let fetchFn = (...a) => fetch(...a);
export function setFetch(fn) {
  fetchFn = fn;
}

export function cleanUrl(url) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/i.test(u)) throw new Error('Engine address must start with http:// or https://');
  return u;
}

async function call(base, path, { method = 'GET', body, accept = 'application/json', timeout = 60000 } = {}) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeout) : null;
  let res;
  try {
    res = await fetchFn(cleanUrl(base) + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json', Accept: accept } : { Accept: accept },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl ? ctl.signal : undefined,
    });
  } catch (e) {
    throw new Error('VOICEVOX engine not reachable at ' + base + ' (' + ((e && e.message) || e) + ')');
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try {
      const j = await res.json();
      msg += ': ' + JSON.stringify(j.detail || j).slice(0, 300);
    } catch {
      /* not JSON */
    }
    throw new Error('VOICEVOX engine error, ' + msg);
  }
  return accept === 'audio/wav' ? new Uint8Array(await res.arrayBuffer()) : res.json();
}

// Singers of the engine: [{ name, styles: [{ name, id, type }] }]. The styles of type
// "sing" or "frame_decode" sing; "singing_teacher" makes the timing.
export async function listSingers(base) {
  const list = await call(base, '/singers');
  return (Array.isArray(list) ? list : []).map((s) => ({
    name: String(s.name || ''),
    uuid: String(s.speaker_uuid || ''),
    styles: (s.styles || []).map((st) => ({ name: String(st.name || ''), id: Number(st.id), type: String(st.type || 'sing') })),
  }));
}

export function teacherOf(singers) {
  for (const s of singers) for (const st of s.styles) if (st.type === 'singing_teacher') return st.id;
  return 6000;
}

// Score of a phrase for the engine: rests and notes in frames, lyrics in katakana.
export function phraseScore(phrase) {
  const notes = [];
  let cursor = 0; // frames written so far
  const frameAt = (t) => Math.round((t - phrase.start) * VV_FPS);
  const push = (key, lyric, until) => {
    const f = frameAt(until) - cursor;
    if (f <= 0) return;
    notes.push({ key, frame_length: f, lyric });
    cursor += f;
  };
  phrase.notes.forEach((n) => {
    push(null, '', n.start); // rest before the note (the first one is required)
    const lyric = n.lyric === 'br' ? '' : toKatakana(n.lyric);
    push(lyric ? n.key : null, lyric, n.end);
  });
  push(null, '', phrase.end);
  // The engine wants a rest first: when the phrase starts on a note, add 2 frames
  // before it (`lead`, cut from the audio afterwards).
  let lead = 0;
  if (!notes.length || notes[0].key !== null) {
    lead = 2;
    notes.unshift({ key: null, frame_length: lead, lyric: '' });
  }
  return { notes, lead };
}

// Renders a phrase: { base, speaker, teacher, pitch(t), dyn(t), sr }.
export async function renderVoicevox(phrase, { base, speaker, teacher = 6000, pitch, dyn, sr = 44100 }) {
  const { notes, lead } = phraseScore(phrase);
  const query = await call(base, '/sing_frame_audio_query?speaker=' + encodeURIComponent(teacher), { method: 'POST', body: { notes } });
  if (!query || !Array.isArray(query.f0)) throw new Error('VOICEVOX engine gave no frame query');
  // Our pitch curve on the voiced frames, our dynamics on the volume.
  for (let i = 0; i < query.f0.length; i++) {
    const t = phrase.start + (i - lead) / VV_FPS;
    if (query.f0[i] > 0) query.f0[i] = midiToHz(pitch(t));
    if (Array.isArray(query.volume) && query.volume[i] != null) query.volume[i] *= dyn(t) / 100;
  }
  const wav = await call(base, '/frame_synthesis?speaker=' + encodeURIComponent(speaker), { method: 'POST', body: query, accept: 'audio/wav' });
  const w = decodeWav(wav);
  const data = resample(w.data, w.sr, sr);
  const len = Math.ceil((phrase.end - phrase.start) * sr);
  const out = new Float32Array(len);
  const skip = Math.round((lead / VV_FPS) * sr);
  out.set(data.subarray(skip, skip + len));
  return { data: out, missing: [] };
}
