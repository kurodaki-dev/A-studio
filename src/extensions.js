// Interface extensions. An extension is a JavaScript file (@type extension)
// that adds buttons, menu items and panels with their own HTML interface,
// and can drive playback and the project through the `astudio` API.
// Its code runs in a sandboxed iframe (opaque origin): it cannot read the app
// page, its storage or its data. Everything goes through postMessage calls,
// and each call is checked against the permissions declared in the header.
import { pluginExtensions } from './plugins.js';

const MAX_HTML = 200 * 1024;
const MAX_STORAGE = 100 * 1024;
const MAX_MESSAGE = 1024 * 1024;
let socketIds = 0;

// Data an extension keeps on the device: its storage (storage API) and the values of
// its settings section, each one JSON object under its own key.
const STORAGE_PREFIX = 'astudio:ext:';
const SETTINGS_PREFIX = 'astudio:extset:';
function readObject(key) {
  try {
    const o = JSON.parse(localStorage.getItem(key) || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}
const storageGet = (ext) => readObject(STORAGE_PREFIX + ext.plugin.id);
const settingsGet = (ext) => readObject(SETTINGS_PREFIX + ext.plugin.id);

// Script injected in every extension frame: it defines the `astudio` API.
export const BOOTSTRAP = `(() => {
  let next = 0;
  const pending = new Map();
  const clicks = new Map();
  const listeners = { state: new Set(), project: new Set(), settings: new Set() };
  const netListeners = new Map();
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    parent.postMessage({ __astudio: 1, id, method, args }, '*');
  });
  addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const m = e.data;
    if (!m || m.__astudio !== 1) return;
    if (m.reply) {
      const p = pending.get(m.reply);
      if (!p) return;
      pending.delete(m.reply);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m.result);
    } else if (m.event === 'click') {
      const f = clicks.get(m.target);
      if (f) f();
    } else if (listeners[m.event]) {
      for (const f of [...listeners[m.event]]) { try { f(m.data); } catch (err) { console.error(err); } }
    } else if (m.event === 'net') {
      const f = netListeners.get(m.data.id);
      if (f) { try { f(m.data); } catch (err) { console.error(err); } }
    }
  });
  addEventListener('error', (e) => parent.postMessage({ __astudio: 1, method: 'error', args: [String(e.message)] }, '*'));
  addEventListener('unhandledrejection', (e) => parent.postMessage({ __astudio: 1, method: 'error', args: [String(e.reason && e.reason.message || e.reason)] }, '*'));
  const withClick = (method) => (options, onClick) => {
    if (options && typeof onClick === 'function') clicks.set(String(options.id), onClick);
    return call(method, options);
  };
  window.astudio = Object.freeze({
    transport: Object.freeze({
      play: () => call('transport.play'),
      stop: () => call('transport.stop'),
      toggle: () => call('transport.toggle'),
      setTempo: (bpm) => call('transport.setTempo', bpm),
      setMode: (mode) => call('transport.setMode', mode),
      getState: () => call('transport.getState'),
    }),
    project: Object.freeze({
      get: () => call('project.get'),
      getNotes: (channel) => call('project.getNotes', channel),
      addChannel: (instrument, name) => call('project.addChannel', instrument, name),
      instruments: () => call('project.instruments'),
      setNotes: (channel, notes) => call('project.setNotes', channel, notes),
      addNotes: (notes) => call('project.addNotes', notes),
      clearNotes: (channel) => call('project.clearNotes', channel),
      selectPattern: (id) => call('project.selectPattern', id),
    }),
    ui: Object.freeze({
      addButton: withClick('ui.addButton'),
      addMenuItem: withClick('ui.addMenuItem'),
      addPanel: (options) => call('ui.addPanel', options),
      openPanel: (id) => call('ui.openPanel', id),
      hint: (text) => call('ui.hint', text),
      addShortcut: withClick('ui.addShortcut'),
    }),
    audio: Object.freeze({
      playNote: (options) => call('audio.playNote', options),
    }),
    settings: Object.freeze({
      addSection: (options) => call('settings.addSection', options),
      get: () => call('settings.get'),
      set: (id, value) => call('settings.set', id, value),
    }),
    net: Object.freeze({
      // Opens a WebSocket to a ws:// or wss:// address. onEvent receives
      // { type: 'open' | 'message' | 'close' | 'error', data }.
      connect: async (url, onEvent) => {
        const id = await call('net.connect', url);
        if (typeof onEvent === 'function') netListeners.set(id, onEvent);
        return Object.freeze({
          id,
          send: (text) => call('net.send', id, String(text)),
          close: () => { netListeners.delete(id); return call('net.close', id); },
        });
      },
    }),
    storage: Object.freeze({
      get: (key) => call('storage.get', key),
      set: (key, value) => call('storage.set', key, value),
      remove: (key) => call('storage.remove', key),
      keys: () => call('storage.keys'),
    }),
    // Listens to 'state', 'project' or 'settings'. Returns a function that stops listening.
    on: (event, fn) => {
      const set = listeners[event];
      if (!set || typeof fn !== 'function') return () => {};
      set.add(fn);
      return () => set.delete(fn);
    },
    off: (event, fn) => { if (listeners[event]) listeners[event].delete(fn); },
  });
})();`;

// Text placed inside a <script> element of srcdoc must not close it early.
const scriptSafe = (code) => String(code).replace(/<\/(script)/gi, '<\\/$1');

// Extra policy for extension frames: no network at all, inline code only.
export const FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

export function frameDoc(code, html = '') {
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + FRAME_CSP + '"><meta name="viewport" content="width=device-width, initial-scale=1"><script>' + scriptSafe(BOOTSTRAP) + '</script>' +
    (code ? '<script>' + scriptSafe(code) + '</script>' : '') + '</head><body>' + html + '</body></html>';
}

// Permission needed for each API method.
export const METHOD_PERMISSION = {
  'transport.play': 'transport',
  'transport.stop': 'transport',
  'transport.toggle': 'transport',
  'transport.setTempo': 'transport',
  'transport.setMode': 'transport',
  'transport.getState': 'transport',
  'project.get': 'project-read',
  'project.getNotes': 'project-read',
  'project.instruments': 'project-read',
  'project.addChannel': 'project-write',
  'project.setNotes': 'project-write',
  'project.addNotes': 'project-write',
  'project.clearNotes': 'project-write',
  'project.selectPattern': 'project-write',
  'ui.addButton': 'ui',
  'ui.addMenuItem': 'ui',
  'ui.addPanel': 'ui',
  'ui.openPanel': 'ui',
  'ui.hint': 'ui',
  'ui.addShortcut': 'ui',
  'settings.addSection': 'ui',
  'settings.get': 'ui',
  'settings.set': 'ui',
  'audio.playNote': 'audio',
  'storage.get': 'storage',
  'storage.set': 'storage',
  'storage.remove': 'storage',
  'storage.keys': 'storage',
  'net.connect': 'network',
  'net.send': 'network',
  'net.close': 'network',
};

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const ITEM_ID = /^[a-zA-Z0-9_-]{1,40}$/;

// app: { store, actions } supplied by main.js (see createExtensionHost there).
export function createExtensionHost(app) {
  const running = new Map(); // extension id -> { plugin, frame, frames:Set, buttons, menu, panels }

  function frameOwner(source) {
    for (const ext of running.values()) {
      for (const f of ext.frames) if (f.contentWindow === source) return { ext, frame: f };
    }
    return null;
  }

  function makeFrame(doc, hidden) {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.className = hidden ? 'ext-runtime' : 'ext-frame';
    f.srcdoc = doc;
    return f;
  }

  async function handle(ext, method, args) {
    const need = METHOD_PERMISSION[method];
    if (!need) throw new Error('Unknown method ' + method);
    if (!ext.plugin.permissions.includes(need)) throw new Error('Permission "' + need + '" is not declared in @permissions');
    const a = Array.isArray(args) ? args.slice(0, 4) : [];
    switch (method) {
      case 'transport.play': return app.actions.play();
      case 'transport.stop': return app.actions.stop();
      case 'transport.toggle': return app.actions.toggle();
      case 'transport.setTempo': return app.actions.setTempo(Number(a[0]));
      case 'transport.setMode': return app.actions.setMode(a[0] === 'song');
      case 'transport.getState': return app.actions.state();
      case 'project.get': return app.actions.projectSummary();
      case 'project.getNotes': return app.actions.getNotes(a[0]);
      case 'project.instruments': return app.actions.instruments();
      case 'project.addChannel': return app.actions.addChannel(str(a[0], 60), str(a[1], 40));
      case 'settings.addSection': {
        const o = a[0] || {};
        const fields = (Array.isArray(o.fields) ? o.fields : []).slice(0, 12).map((f) => ({
          id: str(f && f.id, 40),
          type: ['text', 'password', 'toggle', 'button', 'info'].includes(f && f.type) ? f.type : 'text',
          label: str(f && f.label, 60),
          placeholder: str(f && f.placeholder, 80),
          value: f && f.value !== undefined ? f.value : f && f.type === 'toggle' ? false : '',
        })).filter((f) => ITEM_ID.test(f.id));
        ext.settings = { title: str(o.title, 40) || ext.plugin.name, description: str(o.description, 300), fields };
        const saved = settingsGet(ext);
        for (const f of fields) if (f.type !== 'button' && f.type !== 'info' && !(f.id in saved)) saved[f.id] = f.value;
        ext.settingValues = saved;
        app.actions.extensionSettingsChanged();
        return true;
      }
      case 'settings.get': return { ...(ext.settingValues || settingsGet(ext)) };
      case 'settings.set': {
        if (!ext.settings) throw new Error('Call settings.addSection first');
        const f = ext.settings.fields.find((x) => x.id === str(a[0], 40));
        if (!f) throw new Error('Unknown setting');
        setSetting(ext, f, a[1], false);
        return true;
      }
      case 'net.connect': {
        const url = str(a[0], 300);
        if (!/^wss?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(url)) throw new Error('Only ws:// and wss:// addresses are allowed');
        if (ext.sockets.size >= 2) throw new Error('Two connections at most per extension');
        const id = ++socketIds;
        const ws = new WebSocket(url);
        ext.sockets.set(id, ws);
        const send = (type, data) => post(ext.frame, { event: 'net', data: { id, type, data } });
        ws.onopen = () => send('open');
        ws.onmessage = (e) => send('message', typeof e.data === 'string' ? e.data.slice(0, MAX_MESSAGE) : '');
        ws.onerror = () => send('error', 'Connection error');
        ws.onclose = (e) => {
          ext.sockets.delete(id);
          send('close', e.code);
        };
        return id;
      }
      case 'net.send': {
        const ws = ext.sockets.get(Number(a[0]));
        if (!ws || ws.readyState !== 1) throw new Error('Not connected');
        ws.send(String(a[1]).slice(0, MAX_MESSAGE));
        return true;
      }
      case 'net.close': {
        const ws = ext.sockets.get(Number(a[0]));
        if (ws) ws.close();
        return true;
      }
      case 'project.setNotes': return app.actions.setNotes(a[0], Array.isArray(a[1]) ? a[1].slice(0, 4096) : []);
      case 'audio.playNote': return app.actions.playNote(a[0] || {});
      case 'storage.get': return storageGet(ext)[str(a[0], 100)] ?? null;
      case 'storage.keys': return Object.keys(storageGet(ext));
      case 'storage.set':
      case 'storage.remove': {
        const data = storageGet(ext);
        const key = str(a[0], 100);
        if (!key) throw new Error('A key is required');
        if (method === 'storage.remove') delete data[key];
        else data[key] = a[1] === undefined ? null : a[1];
        const json = JSON.stringify(data);
        if (json.length > MAX_STORAGE) throw new Error('Extension storage is limited to 100 KB');
        try {
          localStorage.setItem(STORAGE_PREFIX + ext.plugin.id, json);
        } catch {
          throw new Error('The device storage is full');
        }
        return true;
      }
      case 'ui.addShortcut': {
        const o = a[0] || {};
        const id = str(o.id, 40);
        const key = str(o.key, 20).toLowerCase();
        if (!ITEM_ID.test(id)) throw new Error('id must use letters, digits, "-" or "_"');
        if (!/^(?:(?:shift|alt)\+)*[a-z0-9]$/.test(key)) throw new Error('key must be a letter or digit, optionally with shift+ or alt+');
        ext.shortcuts.set(id, { key, label: str(o.label, 30) || id, onClick: () => post(ext.frame, { event: 'click', target: id }) });
        return true;
      }
      case 'project.addNotes': return app.actions.addNotes(Array.isArray(a[0]) ? a[0].slice(0, 4096) : []);
      case 'project.clearNotes': return app.actions.clearNotes(a[0]);
      case 'project.selectPattern': return app.actions.selectPattern(str(a[0], 80));
      case 'ui.hint': return app.actions.hint(str(a[0], 200));
      case 'ui.addButton':
      case 'ui.addMenuItem': {
        const o = a[0] || {};
        const id = str(o.id, 40);
        if (!ITEM_ID.test(id)) throw new Error('id must use letters, digits, "-" or "_"');
        const item = { key: ext.plugin.id + ':' + id, label: str(o.label, 30) || id, icon: str(o.icon, 30), onClick: () => post(ext.frame, { event: 'click', target: id }) };
        (method === 'ui.addButton' ? ext.buttons : ext.menu).set(id, item);
        app.actions.extensionsUiChanged();
        return true;
      }
      case 'ui.addPanel': {
        const o = a[0] || {};
        const id = str(o.id, 40);
        if (!ITEM_ID.test(id)) throw new Error('id must use letters, digits, "-" or "_"');
        const html = str(o.html, MAX_HTML);
        const frame = makeFrame(frameDoc('', html), false);
        ext.frames.add(frame);
        const old = ext.panels.get(id);
        if (old) ext.frames.delete(old.frame);
        ext.panels.set(id, { key: ext.plugin.id + ':' + id, title: str(o.title, 30) || id, icon: str(o.icon, 30), frame });
        app.actions.extensionsUiChanged();
        return true;
      }
      case 'ui.openPanel': {
        const p = ext.panels.get(str(a[0], 40));
        if (!p) throw new Error('Unknown panel');
        app.actions.openPanel('ext:' + p.key);
        return true;
      }
      default:
        throw new Error('Unknown method ' + method);
    }
  }

  function post(frame, msg) {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage({ __astudio: 1, ...msg }, '*');
  }

  window.addEventListener('message', async (e) => {
    const m = e.data;
    if (!m || m.__astudio !== 1 || typeof m.method !== 'string') return;
    const owner = frameOwner(e.source);
    if (!owner) return;
    if (m.method === 'error') {
      // One alert every 10 s at most: an extension failing in a loop cannot flood the screen.
      const now = Date.now();
      if (now - (owner.ext.lastError || 0) < 10000) return;
      owner.ext.lastError = now;
      app.actions.extensionError(owner.ext.plugin, str(Array.isArray(m.args) ? m.args[0] : '', 300));
      return;
    }
    try {
      const result = await handle(owner.ext, m.method, m.args);
      post(owner.frame, { reply: m.id, result: result === undefined ? null : result });
    } catch (err) {
      post(owner.frame, { reply: m.id, error: String((err && err.message) || err) });
    }
  });

  function start(plugin) {
    const frame = makeFrame(frameDoc(plugin.code), true);
    const ext = { plugin, frame, frames: new Set([frame]), buttons: new Map(), menu: new Map(), panels: new Map(), shortcuts: new Map(), sockets: new Map(), settings: null, settingValues: null };
    running.set(plugin.id, ext);
    app.runtimeHost.append(frame);
  }

  // A setting changed, from the Settings window (fromUser) or from the extension.
  function setSetting(ext, f, value, fromUser) {
    if (f.type === 'button') {
      if (fromUser) post(ext.frame, { event: 'settings', data: { id: f.id, value: null, values: { ...ext.settingValues }, button: true } });
      return;
    }
    const v = f.type === 'toggle' ? !!value : str(String(value ?? ''), 500);
    if (f.type === 'info') f.value = v;
    else {
      ext.settingValues[f.id] = v;
      try {
        localStorage.setItem(SETTINGS_PREFIX + ext.plugin.id, JSON.stringify(ext.settingValues));
      } catch {
        /* ignore */
      }
    }
    if (fromUser) post(ext.frame, { event: 'settings', data: { id: f.id, value: v, values: { ...ext.settingValues } } });
    else app.actions.extensionSettingsChanged();
  }

  function stopAll() {
    for (const ext of running.values()) for (const ws of ext.sockets.values()) ws.close();
    for (const ext of running.values()) for (const f of ext.frames) f.remove();
    running.clear();
  }

  return {
    // (Re)start every installed extension.
    reload() {
      stopAll();
      for (const p of pluginExtensions()) start(p);
      app.actions.extensionsUiChanged();
    },
    buttons: () => [...running.values()].flatMap((x) => [...x.buttons.values()]),
    menuItems: () => [...running.values()].flatMap((x) => [...x.menu.values()]),
    panels: () => [...running.values()].flatMap((x) => [...x.panels.values()]),
    shortcuts: () => [...running.values()].flatMap((x) => [...x.shortcuts.values()]),
    // Settings sections declared by extensions, for the Settings window.
    settingsSections: () =>
      [...running.values()]
        .filter((x) => x.settings)
        .map((x) => ({
          id: x.plugin.id,
          plugin: x.plugin.name,
          title: x.settings.title,
          description: x.settings.description,
          fields: x.settings.fields.map((f) => ({ ...f, value: f.type === 'info' || f.type === 'button' ? f.value : x.settingValues[f.id] })),
        })),
    changeSetting(extId, fieldId, value) {
      const ext = running.get(extId);
      const f = ext && ext.settings && ext.settings.fields.find((x) => x.id === fieldId);
      if (f) setSetting(ext, f, value, true);
    },
    broadcastProject(data) {
      for (const ext of running.values()) {
        if (!ext.plugin.permissions.includes('project-read')) continue;
        for (const f of ext.frames) post(f, { event: 'project', data });
      }
    },
    // Sends playback state to every frame that listens.
    broadcast(data) {
      for (const ext of running.values()) {
        if (!ext.plugin.permissions.includes('transport')) continue;
        for (const f of ext.frames) post(f, { event: 'state', data });
      }
    },
  };
}
