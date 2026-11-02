// Interface extensions. An extension is a JavaScript file (@type extension)
// that adds buttons, menu items and panels with their own HTML interface,
// and can drive playback and the project through the `astudio` API.
// Its code runs in a sandboxed iframe (opaque origin): it cannot read the app
// page, its storage or its data. Everything goes through postMessage calls,
// and each call is checked against the permissions declared in the header.
import { pluginExtensions } from './plugins.js';

const MAX_HTML = 200 * 1024;

// Script injected in every extension frame: it defines the `astudio` API.
export const BOOTSTRAP = `(() => {
  let next = 0;
  const pending = new Map();
  const clicks = new Map();
  const stateListeners = [];
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
    } else if (m.event === 'state') {
      for (const f of stateListeners) { try { f(m.data); } catch (err) { console.error(err); } }
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
    }),
    on: (event, fn) => { if (event === 'state' && typeof fn === 'function') stateListeners.push(fn); },
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
  'project.addNotes': 'project-write',
  'project.clearNotes': 'project-write',
  'project.selectPattern': 'project-write',
  'ui.addButton': 'ui',
  'ui.addMenuItem': 'ui',
  'ui.addPanel': 'ui',
  'ui.openPanel': 'ui',
  'ui.hint': 'ui',
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
    const a = args || [];
    switch (method) {
      case 'transport.play': return app.actions.play();
      case 'transport.stop': return app.actions.stop();
      case 'transport.toggle': return app.actions.toggle();
      case 'transport.setTempo': return app.actions.setTempo(Number(a[0]));
      case 'transport.setMode': return app.actions.setMode(a[0] === 'song');
      case 'transport.getState': return app.actions.state();
      case 'project.get': return app.actions.projectSummary();
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
      app.actions.extensionError(owner.ext.plugin, str((m.args || [])[0], 300));
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
    const ext = { plugin, frame, frames: new Set([frame]), buttons: new Map(), menu: new Map(), panels: new Map() };
    running.set(plugin.id, ext);
    app.runtimeHost.append(frame);
  }

  function stopAll() {
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
    // Sends playback state to every frame that listens.
    broadcast(data) {
      for (const ext of running.values()) {
        if (!ext.plugin.permissions.includes('transport')) continue;
        for (const f of ext.frames) post(f, { event: 'state', data });
      }
    },
  };
}
