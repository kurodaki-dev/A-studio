// Plugins of A Voice Studio (separate from the A Studio audio plugins): small scripts
// that change notes and lyrics, like the batch edits of OpenUtau. A plugin is JavaScript
// with a header and a run(notes, ctx) function returning the new notes. It runs in a
// Web Worker (no access to the page), stopped after 5 seconds.
//
//   // @name Auto vibrato
//   // @description Vibrato on the long notes
//   export default function run(notes, ctx) {
//     return notes.map((n) => (n.len >= ctx.ppq ? { ...n, vib: { depth: 40, rate: 5.5, delay: 0.4 } } : n));
//   }
//
// Notes: { t, len, key, lyric, vel, porta, vib: { depth, rate, delay } } (t, len in ticks).
// ctx: { ppq, bpm, beats, selection (true when only selected notes are given) }.
import { kv } from './voices/library.js';

export const BUILTIN_PLUGINS = [
  {
    id: 'builtin:vibrato',
    code: `// @name Auto vibrato
// @description Adds a vibrato to notes of one beat or more.
export default function run(notes, ctx) {
  return notes.map((n) => (n.len >= ctx.ppq ? { ...n, vib: { depth: 45, rate: 5.6, delay: 0.4 } } : n));
}`,
  },
  {
    id: 'builtin:legato',
    code: `// @name Legato
// @description Each note lasts until the next one (no gaps), for smooth singing.
export default function run(notes) {
  const s = [...notes].sort((a, b) => a.t - b.t);
  return s.map((n, i) => (s[i + 1] && s[i + 1].t > n.t && s[i + 1].t - n.t < 4 * 480 ? { ...n, len: s[i + 1].t - n.t } : n));
}`,
  },
  {
    id: 'builtin:humanize',
    code: `// @name Humanize timing
// @description Small random changes of timing and velocity, like a live singer.
export default function run(notes) {
  return notes.map((n) => ({ ...n, t: Math.max(0, n.t + Math.round((Math.random() - 0.5) * 24)), vel: Math.min(1, Math.max(0.3, n.vel + (Math.random() - 0.5) * 0.2)) }));
}`,
  },
  {
    id: 'builtin:octave-up',
    code: `// @name Octave up
// @description Moves the notes up 12 semitones.
export default function run(notes) {
  return notes.map((n) => ({ ...n, key: Math.min(127, n.key + 12) }));
}`,
  },
  {
    id: 'builtin:octave-down',
    code: `// @name Octave down
// @description Moves the notes down 12 semitones.
export default function run(notes) {
  return notes.map((n) => ({ ...n, key: Math.max(0, n.key - 12) }));
}`,
  },
  {
    id: 'builtin:portamento',
    code: `// @name Smooth portamento
// @description Longer glides between notes (120 ms).
export default function run(notes) {
  return notes.map((n) => ({ ...n, porta: 120 }));
}`,
  },
];

// Header of a plugin: { name, description }.
export function pluginInfo(code) {
  const name = /\/\/\s*@name\s+(.+)/.exec(code);
  const desc = /\/\/\s*@description\s+(.+)/.exec(code);
  if (!name) throw new Error('A plugin needs a "// @name" line');
  if (!/export\s+default/.test(code)) throw new Error('A plugin needs "export default function run(notes, ctx)"');
  return { name: name[1].trim().slice(0, 60), description: desc ? desc[1].trim().slice(0, 200) : '' };
}

// Worker source: the plugin code with "export default" turned into a variable.
export function workerSource(code) {
  return code.replace(/export\s+default/, 'const __plugin =') +
    '\n;self.onmessage = async (e) => {\n' +
    '  try {\n' +
    '    const fn = typeof __plugin === "function" ? __plugin : __plugin && __plugin.run;\n' +
    '    if (typeof fn !== "function") throw new Error("run is not a function");\n' +
    '    const out = await fn(e.data.notes, e.data.ctx);\n' +
    '    self.postMessage({ ok: true, notes: out });\n' +
    '  } catch (err) { self.postMessage({ ok: false, error: String((err && err.message) || err) }); }\n' +
    '};\n';
}

// Checks what a plugin returned: an array of notes with valid numbers.
export function cleanResult(out, ppqMax = 480 * 4096) {
  if (!Array.isArray(out)) throw new Error('The plugin must return an array of notes');
  return out.slice(0, 20000).map((n) => {
    if (!n || !Number.isFinite(n.t) || !Number.isFinite(n.key)) throw new Error('A returned note has no valid t or key');
    return {
      ...(typeof n.id === 'string' ? { id: n.id } : {}),
      t: Math.max(0, Math.min(ppqMax, Math.round(n.t))),
      len: Math.max(15, Math.round(Number.isFinite(n.len) ? n.len : 480)),
      key: Math.max(0, Math.min(127, Math.round(n.key))),
      lyric: typeof n.lyric === 'string' ? n.lyric.slice(0, 40) : 'ら',
      vel: Number.isFinite(n.vel) ? Math.max(0, Math.min(1, n.vel)) : 0.8,
      porta: Number.isFinite(n.porta) ? Math.max(0, Math.min(1000, n.porta)) : 80,
      vib: n.vib && typeof n.vib === 'object' ? { depth: Math.max(0, Math.min(200, Number(n.vib.depth) || 0)), rate: Math.max(0.5, Math.min(12, Number(n.vib.rate) || 5.5)), delay: Math.max(0, Math.min(1, Number(n.vib.delay) || 0)) } : { depth: 0, rate: 5.5, delay: 0.35 },
    };
  });
}

// Runs a plugin in a worker. Resolves to the cleaned notes.
export function runPlugin(code, notes, ctx, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([workerSource(code)], { type: 'text/javascript' }));
    const w = new globalThis.Worker(url);
    const done = () => {
      clearTimeout(timer);
      w.terminate();
      URL.revokeObjectURL(url);
    };
    const timer = setTimeout(() => { done(); reject(new Error('The plugin took more than 5 seconds and was stopped')); }, timeout);
    w.onmessage = (e) => {
      done();
      if (!e.data || !e.data.ok) return reject(new Error((e.data && e.data.error) || 'Plugin error'));
      try {
        resolve(cleanResult(e.data.notes));
      } catch (err) {
        reject(err);
      }
    };
    w.onerror = (e) => { done(); reject(new Error(e.message || 'Plugin error')); };
    w.postMessage({ notes: JSON.parse(JSON.stringify(notes)), ctx });
  });
}

let installed = [];
export async function loadPlugins() {
  try {
    installed = (await kv.get('plugins')) || [];
  } catch {
    installed = [];
  }
  return allPlugins();
}
export const allPlugins = () => [...BUILTIN_PLUGINS.map((p) => ({ ...p, ...pluginInfo(p.code), builtin: true })), ...installed.map((p) => ({ ...p, ...pluginInfo(p.code) }))];

export async function installPlugin(code) {
  const info = pluginInfo(code);
  const id = 'user:' + info.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  installed = installed.filter((p) => p.id !== id).concat({ id, code });
  await kv.set('plugins', installed);
  return { id, ...info };
}
export async function removePlugin(id) {
  installed = installed.filter((p) => p.id !== id);
  await kv.set('plugins', installed);
}
