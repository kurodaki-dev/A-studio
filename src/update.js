import { h, openModal, alertBox } from './ui/dom.js';
import { isNative } from './platform.js';
import { APP_BUILD, APP_VERSION, LATEST_URL, newerRelease } from './version.js';

const PREF_KEY = 'astudio:autoUpdateCheck';

export function autoCheckEnabled() {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAutoCheck(on) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

// Only the Android app needs updates: the web version is always the latest one.
export const updatesSupported = () => isNative();

async function fetchLatest() {
  const res = await fetch(LATEST_URL, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function showUpdate(rel) {
  const notes = rel.notes
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/gm, '')
    .trim();
  const sizeMb = rel.size ? ' (' + (rel.size / 1048576).toFixed(1).replace('.', ',') + ' Mo)' : '';
  openModal({
    title: 'Mise à jour disponible',
    body: h('div', { class: 'about' },
      h('p', null, 'Version installée : ', h('strong', null, APP_VERSION)),
      h('p', null, 'Nouvelle version : ', h('strong', null, rel.version), sizeMb),
      notes ? h('pre', { class: 'notes' }, notes.slice(0, 2000)) : null,
      h('p', null, 'Le fichier s’ouvre dans votre navigateur. Une fois téléchargé, touchez le pour l’installer par dessus la version actuelle. Vos projets sont conservés.'),
    ),
    actions: [
      { label: 'Plus tard' },
      { label: 'Télécharger', primary: true, onClick: () => { window.location.href = rel.url; } },
    ],
  });
}

// silent: no message when up to date or offline (startup check).
export async function checkForUpdate({ silent }) {
  if (!updatesSupported()) {
    if (!silent) alertBox('Mises à jour', 'La version web est toujours à jour. Les mises à jour concernent l’application Android.');
    return;
  }
  try {
    const rel = newerRelease(await fetchLatest(), APP_BUILD);
    if (rel) showUpdate(rel);
    else if (!silent) alertBox('Mises à jour', 'A Studio est à jour (version ' + APP_VERSION + ').');
  } catch {
    if (!silent) alertBox('Mises à jour', 'Impossible de joindre GitHub. Vérifiez votre connexion et réessayez.');
  }
}
