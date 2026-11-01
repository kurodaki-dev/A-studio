import FR from './locales/fr.js';

// Interface language. English is the default, the source strings are English.
const KEY = 'astudio:lang';
export const LANGS = [
  { id: 'en', name: 'English' },
  { id: 'fr', name: 'Français' },
];

function initial() {
  try {
    return localStorage.getItem(KEY) === 'fr' ? 'fr' : 'en';
  } catch {
    return 'en';
  }
}

export const lang = initial();

export function t(s) {
  return lang === 'fr' ? FR[s] ?? s : s;
}

export const locale = () => (lang === 'fr' ? 'fr-FR' : 'en-GB');

export function fmtNum(n, digits = 1) {
  return n.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// The whole interface is built once, so a language change reloads it.
export function setLang(id) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
  location.reload();
}
