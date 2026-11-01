// Code plugins. A plugin is a JavaScript file that defines an instrument voice:
// the plugin computes its own audio samples. Its code runs only inside an
// AudioWorklet (the audio thread), which has no access to the page, to the
// app storage, to the network or to files. It receives notes and parameter
// values and returns sound. API reference: /doc/#plugins.
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

function parseControls(head) {
  const out = [];
  const seen = new Set();
  for (const raw of head.split(/\r?\n/)) {
    const line = raw.replace(/^\s*\*?\s*/, '');
    for (const [kind, re] of CONTROL_RES) {
      const m = re.exec(line);
      if (!m || seen.has(m[1]) || out.length >= MAX_CONTROLS) continue;
      if (kind === 'knob') {
        const min = Number(m[3]);
        const max = Number(m[4]);
        if (!(max > min)) continue;
        out.push({ kind, id: m[1], name: m[2], min, max, def: clampNum(Number(m[5]), min, max, min) });
      } else if (kind === 'toggle') {
        out.push({ kind, id: m[1], name: m[2], min: 0, max: 1, def: m[3] === '1' ? 1 : 0 });
      } else if (kind === 'choice') {
        const options = m[3].split('|').map((x) => x.slice(0, 20)).filter(Boolean).slice(0, 16);
        if (options.length < 2) continue;
        out.push({ kind, id: m[1], name: m[2], options, min: 0, max: options.length - 1, def: clampNum(Number(m[4] || 0), 0, options.length - 1, 0) });
      } else {
        out.push({ kind, id: m[1], name: m[2], min: 0, max: 1e9, def: 0 });
      }
      seen.add(m[1]);
    }
  }
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
  const name = tag('name').slice(0, 40);
  if (!name) throw new Error('@name is required');
  const type = tag('type') === 'effect' ? 'effect' : 'instrument';
  if (type === 'instrument' && !/registerVoice\s*\(/.test(code)) throw new Error('An instrument must call registerVoice(YourVoiceClass)');
  if (type === 'effect' && !/registerEffect\s*\(/.test(code)) throw new Error('An effect must call registerEffect(YourEffectClass)');
  const params = parseControls(head);
  const cat = tag('category');
  return {
    id,
    name,
    version: tag('version').slice(0, 20) || '1.0.0',
    author: tag('author').slice(0, 60),
    type,
    category: CATS.includes(cat) ? cat : 'synth',
    oneShot: /@oneshot\b/i.test(head),
    params,
    code,
  };
}

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(list)) return [];
    return list
      .map((x) => {
        try {
          return parsePlugin(x && x.code);
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
export const pluginEffects = () => cache.filter((p) => p.type === 'effect');
export const getPlugin = (id) => cache.find((p) => p.id === id) || null;

export function installPlugin(code) {
  const p = parsePlugin(code);
  const list = cache.filter((x) => x.id !== p.id);
  list.push(p);
  localStorage.setItem(KEY, JSON.stringify(list.map((x) => ({ code: x.code }))));
  cache = list;
  return p;
}

export function removePlugin(id) {
  cache = cache.filter((x) => x.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(cache.map((x) => ({ code: x.code }))));
  } catch {
    /* ignore */
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

export const processorName = (p) => 'astudio-' + p.id + '-' + hash(p.code);

// The worklet module: host code, then the plugin code, then the processor.
// Exported for tests.
export function moduleSource(p) {
  return p.type === 'effect' ? effectSource(p) : instrumentSource(p);
}

// Effects process the sound of a mixer insert: process(inL, inR, outL, outR, params).
function effectSource(p) {
  return `"use strict";
let __Effect = null;
function registerEffect(E) { if (typeof E === 'function') __Effect = E; }
${p.code}
;
registerProcessor(${JSON.stringify(processorName(p))}, class extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.params = Object.assign({}, o.params || {});
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
      if (m.type === 'params' && m.values && typeof m.values === 'object') {
        for (const k of Object.keys(m.values)) if (typeof m.values[k] === 'number') this.params[k] = m.values[k];
      } else if (m.type === 'button' && typeof m.id === 'string') {
        this.params[m.id] = (this.params[m.id] || 0) + 1;
        try { if (this.fx && this.fx.button) this.fx.button(m.id, this.params); } catch (err) { this.fail(err); this.fx = null; }
      }
    };
  }
  fail(err) {
    if (this.reported) return;
    this.reported = true;
    this.port.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const oL = out[0];
    const oR = out[1] || out[0];
    const n = oL.length;
    const inp = inputs[0] || [];
    const iL = inp[0] || this.zero.subarray(0, n);
    const iR = inp[1] || iL;
    if (this.fx) {
      try { this.fx.process(iL, iR, oL, oR, this.params); } catch (err) { this.fail(err); this.fx = null; }
    }
    if (!this.fx) {
      // Bypass: a broken effect lets the sound through unchanged.
      oL.set(iL);
      if (oR !== oL) oR.set(iR);
    }
    for (let i = 0; i < n; i++) {
      let a = oL[i];
      oL[i] = a === a ? (a < -4 ? -4 : a > 4 ? 4 : a) : 0;
      if (oR !== oL) {
        a = oR[i];
        oR[i] = a === a ? (a < -4 ? -4 : a > 4 ? 4 : a) : 0;
      }
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
const MAX_VOICES = 32;
const MAX_TAIL = 10;
${p.code}
;
registerProcessor(${JSON.stringify(processorName(p))}, class extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.params = Object.assign({}, o.params || {});
    this.queue = (o.events || []).slice().sort((a, b) => a.frame - b.frame);
    this.voices = [];
    this.L = new Float32Array(128);
    this.R = new Float32Array(128);
    this.reported = false;
    this.port.onmessage = (e) => this.message(e.data);
  }
  message(m) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'note') {
      let i = this.queue.length;
      while (i > 0 && this.queue[i - 1].frame > m.frame) i--;
      this.queue.splice(i, 0, m);
    } else if (m.type === 'off') {
      for (const v of this.voices) if (v.id === m.id) v.offFrame = Math.min(v.offFrame, currentFrame);
      for (const q of this.queue) if (q.id === m.id) q.dur = 0;
    } else if (m.type === 'params' && m.values && typeof m.values === 'object') {
      for (const k of Object.keys(m.values)) if (typeof m.values[k] === 'number') this.params[k] = m.values[k];
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
    this.port.postMessage({ type: 'error', message: String((err && err.message) || err) });
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
      try { alive = v.inst.process(L, R, this.params); } catch (err) { this.fail(err); continue; }
      // Clamp to +-4 and replace NaN with silence, channel by channel.
      for (let i = 0; i < L.length; i++) {
        let a = L[i];
        let b = R[i];
        a = a === a ? (a < -4 ? -4 : a > 4 ? 4 : a) : 0;
        b = b === b ? (b < -4 ? -4 : b > 4 ? 4 : b) : 0;
        oL[i + off] += a;
        if (oR !== oL) oR[i + off] += b;
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
  const map = loaded.get(ctx);
  return !!(map && map.ready && map.ready.has(processorName(p)));
}
