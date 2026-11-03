// Themes of A Voice Studio (separate from the A Studio themes): sets of colours applied
// as CSS variables. Users can import their own (JSON) and pick one.
import { kv } from './voices/library.js';

export const THEME_KEYS = ['bg', 'panel', 'panel2', 'line', 'text', 'dim', 'accent', 'accent2', 'note', 'noteText', 'gridWhite', 'gridBlack', 'gridLine', 'barLine', 'pitch', 'sel', 'danger'];

export const BUILTIN_THEMES = [
  { id: 'aurora', name: 'Aurora', dark: true, colors: { bg: '#14121c', panel: '#1d1a29', panel2: '#262236', line: '#352f4a', text: '#ece8ff', dim: '#9a93b8', accent: '#9d7bff', accent2: '#4fd6c8', note: '#9d7bff', noteText: '#140f24', gridWhite: '#1f1c2c', gridBlack: '#191624', gridLine: '#2a2540', barLine: '#4a4268', pitch: '#4fd6c8', sel: '#ffd166', danger: '#ff6b81' } },
  { id: 'sakura', name: 'Sakura', dark: false, colors: { bg: '#fbf5f7', panel: '#ffffff', panel2: '#f6e9ee', line: '#ead3dc', text: '#3a2630', dim: '#8f6f7d', accent: '#e0578d', accent2: '#5aa9e6', note: '#f08bb4', noteText: '#3a1426', gridWhite: '#fffafc', gridBlack: '#f7edf1', gridLine: '#efdde4', barLine: '#d9b8c6', pitch: '#5aa9e6', sel: '#f4a259', danger: '#d64550' } },
  { id: 'midnight', name: 'Midnight', dark: true, colors: { bg: '#0d1117', panel: '#151b24', panel2: '#1c2430', line: '#2a3444', text: '#dce6f2', dim: '#8796a8', accent: '#3fa7ff', accent2: '#7ee081', note: '#3fa7ff', noteText: '#06131f', gridWhite: '#131a23', gridBlack: '#10161e', gridLine: '#1e2733', barLine: '#34445a', pitch: '#7ee081', sel: '#ffcc4d', danger: '#ff6b6b' } },
  { id: 'paper', name: 'Paper', dark: false, colors: { bg: '#f4f2ee', panel: '#fbfaf7', panel2: '#ebe8e1', line: '#d9d4ca', text: '#2b2a27', dim: '#7c776d', accent: '#2f6f6a', accent2: '#c2603b', note: '#5e9e98', noteText: '#0e2422', gridWhite: '#faf9f6', gridBlack: '#f1eee8', gridLine: '#e6e2da', barLine: '#c9c2b5', pitch: '#c2603b', sel: '#d9a036', danger: '#b33a3a' } },
];

let custom = [];
let current = BUILTIN_THEMES[0];

export const allThemes = () => [...BUILTIN_THEMES, ...custom];
export const currentTheme = () => current;

// Checks an imported theme: a name and colours (missing ones come from Aurora).
export function cleanTheme(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.colors || typeof raw.colors !== 'object') throw new Error('A theme needs a "name" and "colors"');
  const colors = {};
  for (const k of THEME_KEYS) {
    const v = raw.colors[k];
    colors[k] = typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : BUILTIN_THEMES[0].colors[k];
  }
  return { id: 'custom-' + raw.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30), name: raw.name.slice(0, 40), dark: raw.dark !== false, colors, custom: true };
}

export function applyTheme(th) {
  current = th;
  const root = document.documentElement;
  for (const k of THEME_KEYS) root.style.setProperty('--' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), th.colors[k]);
  root.dataset.theme = th.dark ? 'dark' : 'light';
}

export async function loadThemes() {
  try {
    custom = (await kv.get('themes')) || [];
    const id = await kv.get('theme');
    applyTheme(allThemes().find((x) => x.id === id) || BUILTIN_THEMES[0]);
  } catch {
    applyTheme(BUILTIN_THEMES[0]);
  }
}

export async function chooseTheme(id) {
  applyTheme(allThemes().find((x) => x.id === id) || BUILTIN_THEMES[0]);
  await kv.set('theme', current.id);
}

export async function installTheme(raw) {
  const th = cleanTheme(raw);
  custom = custom.filter((x) => x.id !== th.id).concat(th);
  await kv.set('themes', custom);
  return th;
}

export async function removeTheme(id) {
  custom = custom.filter((x) => x.id !== id);
  await kv.set('themes', custom);
  if (current.id === id) await chooseTheme(BUILTIN_THEMES[0].id);
}
