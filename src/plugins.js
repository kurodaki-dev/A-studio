// Code plugins. A plugin is a JavaScript file that defines an instrument voice:
// the plugin computes its own audio samples. Its code runs only inside an
// AudioWorklet (the audio thread), which has no access to the page, to the
// app storage, to the network or to files. It receives notes and parameter
// values and returns sound. API reference: /doc/#plugins.
import { BUILTIN_EFFECTS, getBuiltinEffect } from './audio/builtinfx.js';
import { loadVox, voxReady } from './audio/voxworklet.js';
import { DSP_LIB } from './dsplib.js';
const KEY = 'astudio:plugins';
const MAX_CODE = 256 * 1024;
const CATS = ['drums', 'keys', 'bass', 'synth', 'strings', 'winds', 'mallets'];

const clampNum = (v, a, b, d) => (Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d);

// Reads the header comment (no code is executed on the main thread):
//   @astudio-plugin
//   @id my-synth        @name My Synth        @version 1.0.0
//   @author Me          @category synth       @type instrument | effect
//   @param cutoff "Cutoff" 0 1 0.5         knob
//   @toggle mono "Mono" 0                   switch, value 0 or 1
//   @choice wave "Wave" saw|square|sine 0   list, value = index
//   @button random "Randomize"              push button
const ID = '[a-zA-Z][a-zA-Z0-9_]{0,30}';
const LABEL = '"([^"\\r\\n]{1,30})"';
const NUM = '(-?\\d+(?:\\.\\d+)?)';
const CONTROL_RES = [
  ['knob', new RegExp('^@param[ \\t]+(' + ID + ')[ \\t]+' + LABEL + '[ \\t]+' + NUM + '[ \\t]+' + NUM + '[ \\t]+' + NUM)],
  ['toggle', new RegExp('^@toggle[ \\t]+(' + ID + ')[ \\t]+' + LABEL + '(?:[ \\t]+([01]))?')],
  ['choice', new RegExp('^@choice[ \\t]+(' + ID + ')[ \\t]+' + LABEL + '[ \\t]+([^ \\t\\r\\n]+)(?:[ \\t]+(\\d+))?')],
  ['button', new RegExp('^@button[ \\t]+(' + ID + ')[ \\t]+' + LABEL)],
];
export const MAX_CONTROLS = 12;
// What an extension may do, declared with @permissions in its header.
export const PERMISSIONS = ['ui', 'transport', 'project-read', 'project-write', 'audio', 'storage', 'network'];

// warn(line, message): header lines that are ignored, so the editor can say why.
function parseControls(head, warn = () => {}) {
  const out = [];
  const seen = new Set();
  head.split(/\r?\n/).forEach((raw, n) => {
    const line = raw.replace(/^\s*\*?\s*/, '');
    const tag = /^@(param|toggle|choice|button)\b/.exec(line);
    if (!tag) return;
    const kind = tag[1] === 'param' ? 'knob' : tag[1];
    const m = CONTROL_RES.find((x) => x[0] === kind)[1].exec(line);
    if (!m) return warn(n + 1, '@' + tag[1] + ' is not written as in the documentation, it is ignored');
    if (seen.has(m[1])) return warn(n + 1, 'The control id ' + m[1] + ' is used twice, the second one is ignored');
    if (out.length >= MAX_CONTROLS) return warn(n + 1, 'More than ' + MAX_CONTROLS + ' controls, this one is ignored');
    if (kind === 'knob') {
      const min = Number(m[3]);
      const max = Number(m[4]);
      if (!(max > min)) return warn(n + 1, 'The maximum of ' + m[1] + ' must be larger than its minimum');
      out.push({ kind, id: m[1], name: m[2], min, max, def: clampNum(Number(m[5]), min, max, min) });
    } else if (kind === 'toggle') {
      out.push({ kind, id: m[1], name: m[2], min: 0, max: 1, def: m[3] === '1' ? 1 : 0 });
    } else if (kind === 'choice') {
      const options = m[3].split('|').map((x) => x.slice(0, 20)).filter(Boolean).slice(0, 16);
      if (options.length < 2) return warn(n + 1, 'A choice needs at least two options separated by |');
      out.push({ kind, id: m[1], name: m[2], options, min: 0, max: options.length - 1, def: clampNum(Number(m[4] || 0), 0, options.length - 1, 0) });
    } else {
      out.push({ kind, id: m[1], name: m[2], min: 0, max: 1e9, def: 0 });
    }
    seen.add(m[1]);
  });
  return out;
}

export function parsePlugin(code) {
  if (typeof code !== 'string' || !code.trim()) throw new Error('The file is empty');
  if (code.length > MAX_CODE) throw new Error('The plugin is larger than 256 KB');
  const head = code.slice(0, 8000);
  if (!/@astudio-plugin\b/.test(head)) throw new Error('Missing the @astudio-plugin header');
  const tag = (name) => {
    const m = new RegExp('@' + name + '[ \\t]+([^\\r\\n*]+)').exec(head);
    return m ? m[1].trim() : '';
  };
  const id = tag('id').toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error('@id must use a to z, 0 to 9 and "-" only');
  if (getBuiltinEffect(id)) throw new Error('@id ' + id + ' is reserved for a built in effect');
  const name = tag('name').slice(0, 40);
  if (!name) throw new Error('@name is required');
  const rawType = tag('type');
  const type = rawType === 'effect' ? 'effect' : rawType === 'extension' ? 'extension' : 'instrument';
  if (type === 'instrument' && !/registerVoice\s*\(/.test(code)) throw new Error('An instrument must call registerVoice(YourVoiceClass)');
  if (type === 'effect' && !/registerEffect\s*\(/.test(code)) throw new Error('An effect must call registerEffect(YourEffectClass)');
  const warnings = [];
  const warn = (line, message) => {
    if (warnings.length < 20) warnings.push({ line, message });
  };
  const params = type === 'extension' ? [] : parseControls(head, warn);
  const presets = type === 'extension' ? [] : parsePresets(head, params);
  const asked = type === 'extension' ? tag('permissions').split(/[\s,]+/).filter(Boolean) : [];
  for (const x of asked) if (!PERMISSIONS.includes(x)) warn(null, 'Unknown permission "' + x + '" (allowed: ' + PERMISSIONS.join(', ') + ')');
  const permissions = [...new Set(asked.filter((x) => PERMISSIONS.includes(x)))];
  if (rawType && !['instrument', 'effect', 'extension'].includes(rawType)) warn(null, 'Unknown @type "' + rawType + '", read as instrument');
  const cat = tag('category');
  if (cat && !CATS.includes(cat)) warn(null, 'Unknown @category "' + cat + '" (allowed: ' + CATS.join(', ') + ')');
  return {
    id,
    name,
    version: tag('version').slice(0, 20) || '1.0.0',
    author: tag('author').slice(0, 60),
    type,
    permissions,
    category: CATS.includes(cat) ? cat : 'synth',
    oneShot: /@oneshot\b/i.test(head),
    params,
    presets,
    warnings,
    code,
  };
}

// @preset "Name" id=value id=value ...  (unknown ids are ignored)
function parsePresets(head, params) {
  const out = [];
  const ids = new Set(params.filter((p) => p.kind !== 'button').map((p) => p.id));
  for (const raw of head.split(/\r?\n/)) {
    const line = raw.replace(/^\s*\*?\s*/, '');
    const m = /^@preset[ \t]+"([^"\r\n]{1,30})"((?:[ \t]+[a-zA-Z][a-zA-Z0-9_]{0,30}=-?\d+(?:\.\d+)?)*)/.exec(line);
    if (!m || out.length >= 32) continue;
    const values = {};
    for (const kv of m[2].trim().split(/[ \t]+/).filter(Boolean)) {
      const [k, v] = kv.split('=');
      if (ids.has(k)) values[k] = Number(v);
    }
    out.push({ name: m[1], values });
  }
  return out;
}

// Presets saved by the user, per plugin.
const PRESET_KEY = 'astudio:presets';
function readPresets() {
  try {
    const o = JSON.parse(localStorage.getItem(PRESET_KEY) || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

export function userPresets(pluginId) {
  const list = readPresets()[pluginId];
  return Array.isArray(list) ? list.filter((x) => x && typeof x.name === 'string' && x.values && typeof x.values === 'object') : [];
}

export function saveUserPreset(pluginId, name, values) {
  const all = readPresets();
  const list = userPresets(pluginId).filter((x) => x.name !== name);
  list.push({ name: String(name).slice(0, 30), values });
  all[pluginId] = list.slice(-64);
  localStorage.setItem(PRESET_KEY, JSON.stringify(all));
}

export function deleteUserPreset(pluginId, name) {
  const all = readPresets();
  all[pluginId] = userPresets(pluginId).filter((x) => x.name !== name);
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

// Saves the installed plugins. A full storage leaves the list as it was.
function persist(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.map((x) => ({ code: x.code, source: x.source }))));
  } catch {
    throw new Error('The device storage is full: delete a plugin or a theme first');
  }
}

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(list)) return [];
    return list
      .map((x) => {
        try {
          const p = parsePlugin(x && x.code);
          if (x && typeof x.source === 'string' && x.source.startsWith('https://raw.githubusercontent.com/')) p.source = x.source;
          return p;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

let cache = read();

export const allPlugins = () => cache;
export const pluginInstruments = () => cache.filter((p) => p.type === 'instrument');
export const pluginEffects = () => [...BUILTIN_EFFECTS, ...cache.filter((p) => p.type === 'effect')];
export const pluginExtensions = () => cache.filter((p) => p.type === 'extension');
export const getPlugin = (id) => getBuiltinEffect(id) || cache.find((p) => p.id === id) || null;

// source: the raw GitHub address the plugin came from, used to update it.
export function installPlugin(code, source) {
  const p = parsePlugin(code);
  if (typeof source === 'string' && source.startsWith('https://raw.githubusercontent.com/')) p.source = source;
  const list = [...cache.filter((x) => x.id !== p.id), p];
  persist(list);
  cache = list;
  return p;
}

export function removePlugin(id) {
  cache = cache.filter((x) => x.id !== id);
  // Its data goes with it: extension storage and settings, saved presets.
  try {
    localStorage.removeItem('astudio:ext:' + id);
    localStorage.removeItem('astudio:extset:' + id);
    const all = readPresets();
    if (id in all) {
      delete all[id];
      localStorage.setItem(PRESET_KEY, JSON.stringify(all));
    }
  } catch {
    /* ignore */
  }
  try {
    persist(cache);
  } catch {
    /* removing frees space: nothing to report */
  }
}

// Parameter values of a channel, completed with the plugin defaults.
export function paramValues(plugin, stored) {
  const out = {};
  for (const p of plugin.params) {
    if (p.kind === 'button') continue;
    let v = clampNum(stored && stored[p.id], p.min, p.max, p.def);
    if (p.kind !== 'knob') v = Math.round(v);
    out[p.id] = v;
  }
  return out;
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export const processorName = (p) => (p.builtin ? 'builtin:' + p.id : 'astudio-' + p.id + '-' + hash(p.code));

// The worklet module: host code, then the plugin code, then the processor.
// Exported for tests.
export function moduleSource(p) {
  return p.type === 'effect' ? effectSource(p) : instrumentSource(p);
}

// Line of the plugin file where an error happened, from the stack of the worklet
// error (the generated module adds the host code and the dsp library before it).
export function pluginErrorLine(p, stack) {
  if (!stack) return null;
  const src = moduleSource(p);
  const first = src.slice(0, src.indexOf('// @astudio-user-code')).split('\n').length + 1;
  const m = /:(\d+):(\d+)\)?\s*$/m.exec(String(stack).split('\n').find((l) => /blob:|:\d+:\d+/.test(l) && !/registerProcessor/.test(l)) || '');
  if (!m) return null;
  const line = Number(m[1]) - first + 1;
  return line >= 1 && line <= p.code.split('\n').length ? line : null;
}

// Error listeners (the plugin editor shows errors of the plugin it edits).
const errorListeners = new Set();
export const onPluginErrorEvent = (fn) => {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
};
export function reportPluginError(p, message, stack) {
  const line = pluginErrorLine(p, stack);
  for (const fn of errorListeners) fn(p, message, line);
  return line;
}

// Host code shared by instruments and effects (worklet side): playback position for
// the plugin, number checks for parameter messages and a safe output (NaN becomes
// silence, samples are kept within +-4 so a broken plugin cannot blast the speakers).
const HOST_COMMON = `const __transport = { bpm: 120, playing: false, beat: 0 };
let __anchor = { position: 0, at: 0 };
function __setTransport(t) {
  if (!t || typeof t !== 'object') return;
  if (typeof t.bpm === 'number' && t.bpm > 0) __transport.bpm = t.bpm;
  if (typeof t.playing === 'boolean') __transport.playing = t.playing;
  __anchor = { position: typeof t.position === 'number' ? t.position : 0, at: typeof t.at === 'number' ? t.at : currentTime };
  __transport.beat = __anchor.position / 96;
}
function __tick() {
  if (__transport.playing) __transport.beat = (__anchor.position + (currentTime - __anchor.at) * __transport.bpm * 96 / 60) / 96;
}
function __setParams(params, values) {
  if (!values || typeof values !== 'object') return;
  for (const k of Object.keys(values)) if (typeof values[k] === 'number' && values[k] === values[k]) params[k] = values[k];
}
function __safe(x) {
  return x === x ? (x < -4 ? -4 : x > 4 ? 4 : x) : 0;
}
`;

// Effects process the sound of a mixer insert: process(inL, inR, outL, outR, params).
function effectSource(p) {
  return `"use strict";
let __Effect = null;
function registerEffect(E) { if (typeof E === 'function') __Effect = E; }
${HOST_COMMON}
${DSP_LIB}
// @astudio-user-code
${p.code}
;
registerProcessor(${JSON.stringify(processorName(p))}, class extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.params = {};
    __setParams(this.params, o.params);
    __setTransport(o.transport);
    this.zero = new Float32Array(128);
    this.reported = false;
    this.fx = null;
    if (!__Effect) this.fail('registerEffect was not called');
    else {
      try { this.fx = new __Effect({ sampleRate, params: this.params }); } catch (err) { this.fail(err); }
    }
    this.port.onmessage = (e) => {
      const m = e.data;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'transport') __setTransport(m);
      else if (m.type === 'params') __setParams(this.params, m.values);
      else if (m.type === 'button' && typeof m.id === 'string') {
        this.params[m.id] = (this.params[m.id] || 0) + 1;
        try { if (this.fx && this.fx.button) this.fx.button(m.id, this.params); } catch (err) { this.fail(err); this.fx = null; }
      }
    };
  }
  fail(err) {
    if (this.reported) return;
    this.reported = true;
    this.port.postMessage({ type: 'error', message: String((err && err.message) || err), stack: String((err && err.stack) || '') });
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const oL = out[0];
    const oR = out[1] || out[0];
    const n = oL.length;
    const inp = inputs[0] || [];
    const iL = inp[0] || this.zero.subarray(0, n);
    const iR = inp[1] || iL;
    __tick();
    if (this.fx) {
      try { this.fx.process(iL, iR, oL, oR, this.params, __transport); } catch (err) { this.fail(err); this.fx = null; }
    }
    if (!this.fx) {
      // Bypass: a broken effect lets the sound through unchanged.
      oL.set(iL);
      if (oR !== oL) oR.set(iR);
    }
    for (let i = 0; i < n; i++) {
      oL[i] = __safe(oL[i]);
      if (oR !== oL) oR[i] = __safe(oR[i]);
    }
    return true;
  }
});
`;
}

function instrumentSource(p) {
  return `"use strict";
let __Voice = null;
function registerVoice(V) { if (typeof V === 'function') __Voice = V; }
${HOST_COMMON}
const MAX_VOICES = 32;
const MAX_TAIL = 10;
${DSP_LIB}
// @astudio-user-code
${p.code}
;
registerProcessor(${JSON.stringify(processorName(p))}, class extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.params = {};
    __setParams(this.params, o.params);
    __setTransport(o.transport);
    this.queue = (o.events || []).slice().sort((a, b) => a.frame - b.frame);
    this.voices = [];
    this.L = new Float32Array(128);
    this.R = new Float32Array(128);
    this.reported = false;
    this.port.onmessage = (e) => this.message(e.data);
  }
  message(m) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'transport') {
      __setTransport(m);
    } else if (m.type === 'note') {
      let i = this.queue.length;
      while (i > 0 && this.queue[i - 1].frame > m.frame) i--;
      this.queue.splice(i, 0, m);
    } else if (m.type === 'off') {
      for (const v of this.voices) if (v.id === m.id) v.offFrame = Math.min(v.offFrame, currentFrame);
      for (const q of this.queue) if (q.id === m.id) q.dur = 0;
    } else if (m.type === 'params') {
      __setParams(this.params, m.values);
    } else if (m.type === 'button' && typeof m.id === 'string') {
      this.params[m.id] = (this.params[m.id] || 0) + 1;
      for (const v of this.voices) {
        try { if (v.inst.button) v.inst.button(m.id, this.params); } catch (err) { this.fail(err); }
      }
    } else if (m.type === 'stop') {
      this.voices = [];
      this.queue = [];
    }
  }
  fail(err) {
    if (this.reported) return;
    this.reported = true;
    this.port.postMessage({ type: 'error', message: String((err && err.message) || err), stack: String((err && err.stack) || '') });
  }
  start(ev, offset) {
    if (!__Voice) return this.fail('registerVoice was not called');
    let inst;
    try {
      inst = new __Voice({ key: ev.key, frequency: ev.freq, velocity: ev.vel, sampleRate, params: this.params });
    } catch (err) {
      return this.fail(err);
    }
    if (this.voices.length >= MAX_VOICES) this.voices.shift();
    const off = ev.dur === Infinity || ev.dur == null ? Infinity : ev.frame + Math.max(1, Math.round(ev.dur * sampleRate));
    this.voices.push({ id: ev.id, inst, offset, offFrame: off, released: false, killFrame: Infinity });
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const oL = out[0];
    const oR = out[1] || out[0];
    const n = oL.length;
    __tick();
    const now = currentFrame;
    const end = now + n;
    while (this.queue.length && this.queue[0].frame < end) {
      const ev = this.queue.shift();
      this.start(ev, Math.max(0, ev.frame - now));
    }
    const keep = [];
    for (const v of this.voices) {
      if (!v.released && v.offFrame < end) {
        v.released = true;
        v.killFrame = end + MAX_TAIL * sampleRate;
        try { if (v.inst.noteOff) v.inst.noteOff(); } catch (err) { this.fail(err); continue; }
      }
      const off = v.offset;
      v.offset = 0;
      const L = this.L.subarray(0, n - off);
      const R = this.R.subarray(0, n - off);
      L.fill(0);
      R.fill(0);
      let alive;
      try { alive = v.inst.process(L, R, this.params, __transport); } catch (err) { this.fail(err); continue; }
      // Clamp to +-4 and replace NaN with silence, channel by channel.
      for (let i = 0; i < L.length; i++) {
        oL[i + off] += __safe(L[i]);
        if (oR !== oL) oR[i + off] += __safe(R[i]);
      }
      if (alive !== false && end < v.killFrame) keep.push(v);
    }
    this.voices = keep;
    return true;
  }
});
`;
}

// Load a plugin module into an audio context once. Resolves to true when ready.
const loaded = new WeakMap();
export function loadPluginModule(ctx, p) {
  if (p.builtin) return p.worklet ? loadVox(ctx) : Promise.resolve(true);
  let map = loaded.get(ctx);
  if (!map) loaded.set(ctx, (map = new Map()));
  const name = processorName(p);
  if (map.has(name)) return map.get(name);
  const url = URL.createObjectURL(new Blob([moduleSource(p)], { type: 'text/javascript' }));
  const prom = ctx.audioWorklet
    .addModule(url)
    .then(() => true)
    .catch(() => false)
    .finally(() => URL.revokeObjectURL(url));
  map.set(name, prom);
  prom.then((ok) => {
    map.ready = map.ready || new Set();
    if (ok) map.ready.add(name);
  });
  return prom;
}

export function pluginReady(ctx, p) {
  if (p.builtin) return p.worklet ? voxReady(ctx) : true;
  const map = loaded.get(ctx);
  return !!(map && map.ready && map.ready.has(processorName(p)));
}
