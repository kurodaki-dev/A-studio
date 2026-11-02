// MIDI keyboard input (Web MIDI). Notes play the current channel (the one open in
// the piano roll) and are recorded into the pattern while recording is armed.
import { store, currentPattern, getChannel, notesFor, patternLength } from './store.js';
import { ui } from './ui-state.js';
import { snapTicks, STEP } from './constants.js';

const KEY = 'astudio:midi';
let access = null;
let engineRef = null;
const held = new Map(); // key -> { voice, start, channelId, vel }
const listeners = new Set();

export const midiSupported = () => typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
export function midiEnabled() {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}
export const onMidiChange = (fn) => listeners.add(fn);
const changed = () => listeners.forEach((fn) => fn());

export function midiInputs() {
  if (!access) return [];
  return [...access.inputs.values()].map((i) => ({ id: i.id, name: i.name || 'MIDI input', state: i.state }));
}

function channel() {
  const p = store.project;
  return getChannel(p, ui.prChannel) || p.channels[0] || null;
}

function noteOn(key, velocity) {
  const c = channel();
  if (!c || !engineRef) return;
  noteOff(key);
  const vel = Math.max(0.05, velocity / 127);
  const voice = engineRef.noteOn(c, key, vel);
  held.set(key, { voice, start: engineRef.position(), channelId: c.id, vel });
  if (ui.onMidiNote) ui.onMidiNote(key);
}

function noteOff(key) {
  const h = held.get(key);
  if (!h) return;
  held.delete(key);
  engineRef.noteOff(h.voice);
  // Record while the pattern plays in PAT mode with recording armed.
  if (ui.recording && engineRef.playing && !ui.songMode && !engineRef.countingIn()) {
    const pat = currentPattern(store.project);
    const L = patternLength(pat);
    const snap = snapTicks(ui.prSnap);
    let len = engineRef.position() - h.start;
    if (len < 0) len += L;
    const t = ((Math.round(h.start / snap) * snap) % L + L) % L;
    store.commit();
    notesFor(pat, h.channelId).push({ t, len: Math.max(snap, Math.round(len / snap) * snap || STEP), key, vel: h.vel });
    store.emit();
  }
}

function onMessage(e) {
  if (!midiEnabled()) return;
  const [st, a, b] = e.data;
  const type = st & 0xf0;
  if (type === 0x90 && b > 0) noteOn(a, b);
  else if (type === 0x80 || (type === 0x90 && b === 0)) noteOff(a);
}

function bind() {
  if (!access) return;
  for (const input of access.inputs.values()) input.onmidimessage = onMessage;
  changed();
}

export async function initMidi(engine) {
  engineRef = engine;
  if (!midiSupported() || access) return;
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
    access.onstatechange = bind;
    bind();
  } catch {
    access = null;
  }
}

export function setMidiEnabled(on) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
  if (on && engineRef) initMidi(engineRef);
  changed();
}
