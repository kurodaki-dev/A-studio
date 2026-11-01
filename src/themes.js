// Color themes. A theme is a JSON file with colors only (hex values), so it
// cannot inject anything into the page. Format: see /doc.
const KEY_LIST = 'astudio:themes';
const KEY_CURRENT = 'astudio:theme';
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// UI colors (CSS variables) and editor colors (canvas).
export const UI_KEYS = ['bg', 'panel', 'panel2', 'panel3', 'line', 'text', 'dim', 'accent', 'green', 'red', 'input', 'lcd', 'lcd-text'];
export const EDITOR_KEYS = ['gridWhite', 'gridBlack', 'note', 'noteSelected', 'playhead', 'trackA', 'trackB', 'ruler'];

const BUILT_IN = [
  {
    id: 'default',
    name: 'A Studio',
    colors: { bg: '#1e2427', panel: '#2f383d', panel2: '#384349', panel3: '#46525a', line: '#161b1e', text: '#d5dcdf', dim: '#8e9ba1', accent: '#f0993a', green: '#8fcf6a', red: '#e0605a', input: '#20272b', lcd: '#12181b', 'lcd-text': '#b9e08a' },
    editor: { gridWhite: '#36444b', gridBlack: '#2c383e', note: '#8fd17c', noteSelected: '#f18b80', playhead: '#f0993a', trackA: '#344147', trackB: '#2f3a3f', ruler: '#2b3337' },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    colors: { bg: '#18191b', panel: '#26282b', panel2: '#303236', panel3: '#3c3f44', line: '#0f1012', text: '#dcdde0', dim: '#8b8f96', accent: '#4fa3e0', green: '#7cc77a', red: '#e0605a', input: '#1b1c1e', lcd: '#0e0f10', 'lcd-text': '#9fd3f5' },
    editor: { gridWhite: '#30333a', gridBlack: '#282a30', note: '#7fb8e8', noteSelected: '#f2a65a', playhead: '#4fa3e0', trackA: '#2e3136', trackB: '#292b30', ruler: '#232528' },
  },
  {
    id: 'daylight',
    name: 'Daylight',
    colors: { bg: '#c9ced1', panel: '#e3e7e9', panel2: '#d4d9dc', panel3: '#c3c9cd', line: '#9aa3a8', text: '#1f2629', dim: '#56636a', accent: '#d9781c', green: '#3f9a3a', red: '#c0392b', input: '#f4f6f7', lcd: '#1f2629', 'lcd-text': '#b9e08a' },
    editor: { gridWhite: '#dfe4e6', gridBlack: '#cdd3d6', note: '#4d9e45', noteSelected: '#d0503f', playhead: '#d9781c', trackA: '#dde2e4', trackB: '#d3d9dc', ruler: '#c3c9cd' },
  },
];

export function validateTheme(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Not a JSON object');
  if (raw.type !== 'astudio-theme') throw new Error('"type" must be "astudio-theme"');
  const id = typeof raw.id === 'string' ? raw.id.trim().toLowerCase() : '';
  if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error('"id" must use a to z, 0 to 9 and "-" only');
  if (BUILT_IN.some((t) => t.id === id)) throw new Error('This id is reserved by a built in theme');
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : '';
  if (!name) throw new Error('"name" is required');
  const base = BUILT_IN[0];
  const pick = (src, keys, def) => {
    const out = {};
    for (const k of keys) out[k] = src && HEX.test(src[k]) ? src[k] : def[k];
    return out;
  };
  return {
    type: 'astudio-theme',
    id,
    name,
    author: typeof raw.author === 'string' ? raw.author.slice(0, 60) : '',
    colors: pick(raw.colors, UI_KEYS, base.colors),
    editor: pick(raw.editor, EDITOR_KEYS, base.editor),
  };
}

function readInstalled() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY_LIST) || '[]');
    return Array.isArray(list) ? list.map((x) => { try { return validateTheme(x); } catch { return null; } }).filter(Boolean) : [];
  } catch {
    return [];
  }
}

let installed = readInstalled();
let current = BUILT_IN[0];

export const allThemes = () => [...BUILT_IN.map((t) => ({ ...t, builtIn: true })), ...installed];
export const currentTheme = () => current;
export const editorColors = () => current.editor;

export function applyTheme(id) {
  const th = allThemes().find((t) => t.id === id) || BUILT_IN[0];
  current = th;
  const root = document.documentElement.style;
  for (const k of UI_KEYS) root.setProperty('--' + k, th.colors[k]);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', th.colors.bg);
  document.documentElement.style.colorScheme = th.id === 'daylight' || isLight(th.colors.bg) ? 'light' : 'dark';
  try {
    localStorage.setItem(KEY_CURRENT, th.id);
  } catch {
    /* ignore */
  }
}

function isLight(hex) {
  const h = hex.length === 4 ? hex.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : hex;
  const n = parseInt(h.slice(1), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 150;
}

export function initTheme() {
  let id = 'default';
  try {
    id = localStorage.getItem(KEY_CURRENT) || 'default';
  } catch {
    /* ignore */
  }
  applyTheme(id);
}

export function installTheme(raw) {
  const th = validateTheme(raw);
  installed = installed.filter((x) => x.id !== th.id);
  installed.push(th);
  localStorage.setItem(KEY_LIST, JSON.stringify(installed));
  return th;
}

export function removeTheme(id) {
  installed = installed.filter((x) => x.id !== id);
  try {
    localStorage.setItem(KEY_LIST, JSON.stringify(installed));
  } catch {
    /* ignore */
  }
  if (current.id === id) applyTheme('default');
}
