// Translations of A Voice Studio (English source strings, French table).
import fr from './locales/fr.js';

const TABLES = { fr };
function pickLang() {
  try {
    const own = localStorage.getItem('avs:lang') || localStorage.getItem('astudio:lang');
    if (own && (own === 'en' || TABLES[own])) return own;
  } catch {
    /* storage blocked */
  }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return nav.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}
export let lang = typeof window === 'undefined' ? 'en' : pickLang();
export function setLang(l) {
  lang = l;
  try {
    localStorage.setItem('avs:lang', l);
  } catch {
    /* storage blocked */
  }
}
export function t(s) {
  const tb = TABLES[lang];
  return (tb && tb[s]) || s;
}

// Error messages from the engines: whole message, or its fixed beginning translated.
export function tErr(msg) {
  const s = String(msg == null ? '' : msg);
  const tb = TABLES[lang];
  if (!tb) return s;
  if (tb[s]) return tb[s];
  let best = '';
  for (const k of Object.keys(tb)) if (k.length > best.length && /[:(,] ?$|at $/.test(k) && s.startsWith(k)) best = k;
  return best ? tb[best] + s.slice(best.length) : s;
}
