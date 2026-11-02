import { h, openModal, alertBox } from './ui/dom.js';
import { registerPlugin } from '@capacitor/core';
import { isNative } from './platform.js';
import { APP_BUILD, APP_VERSION, LATEST_URL, newerRelease } from './version.js';
import { t, fmtNum } from './i18n.js';

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

const AppUpdater = registerPlugin('AppUpdater');

// Download inside the app, then open the Android installer.
async function installUpdate(rel) {
  try {
    const { allowed } = await AppUpdater.canInstall();
    if (!allowed) {
      openModal({
        title: t('Permission needed'),
        body: h('p', null, t('Android asks you to allow A Studio to install updates. Turn on “Allow from this source”, come back, then tap Download again.')),
        actions: [
          { label: t('Cancel') },
          { label: t('Open settings'), primary: true, onClick: () => AppUpdater.openInstallSettings() },
        ],
      });
      return;
    }
  } catch {
    window.location.href = rel.url;
    return;
  }
  const bar = h('div', { class: 'progress-fill' });
  const label = h('p', null, t('Downloading...'));
  const m = openModal({ title: t('Update'), body: h('div', null, label, h('div', { class: 'progress' }, bar)), actions: [] });
  const sub = await AppUpdater.addListener('progress', ({ received, total }) => {
    const pct = total > 0 ? Math.round((received / total) * 100) : 0;
    bar.style.width = pct + '%';
    label.textContent = t('Downloading...') + ' ' + (total > 0 ? pct + '%' : fmtNum(received / 1048576) + ' MB');
  });
  try {
    await AppUpdater.downloadAndInstall({ url: rel.url });
    label.textContent = t('Confirm the install in the Android window. A Studio restarts with the new version once you tap Open.');
    bar.style.width = '100%';
    setTimeout(() => m.close(), 4000);
  } catch (e) {
    m.close();
    alertBox(t('Update'), t('The download failed: ') + String((e && e.message) || e));
  } finally {
    sub.remove();
  }
}

function showUpdate(rel) {
  const notes = rel.notes
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/gm, '')
    .trim();
  const sizeMb = rel.size ? ' (' + fmtNum(rel.size / 1048576) + t(' MB)') : '';
  openModal({
    title: t('Update available'),
    body: h('div', { class: 'about' },
      h('p', null, t('Installed version: '), h('strong', null, APP_VERSION)),
      h('p', null, t('New version: '), h('strong', null, rel.version), sizeMb),
      notes ? h('pre', { class: 'notes' }, notes.slice(0, 2000)) : null,
      h('p', null, t('The update downloads inside the app, then Android asks you to confirm the install. Your projects are kept.')),
    ),
    actions: [
      { label: t('Later') },
      { label: t('Download'), primary: true, onClick: () => { installUpdate(rel); } },
    ],
  });
}

// silent: no message when up to date or offline (startup check).
export async function checkForUpdate({ silent }) {
  if (!updatesSupported()) {
    if (!silent) alertBox(t('Updates'), t('The web version is always up to date. Updates apply to the Android app.'));
    return;
  }
  try {
    const rel = newerRelease(await fetchLatest(), APP_BUILD);
    if (rel) showUpdate(rel);
    else if (!silent) alertBox(t('Updates'), t('A Studio is up to date (version ') + APP_VERSION + ').');
  } catch {
    if (!silent) alertBox(t('Updates'), t('Could not reach GitHub. Check your connection and try again.'));
  }
}

// Screen orientation on Android: 'landscape' or 'auto'. Stored on the device.
export function orientationPref() {
  try {
    return localStorage.getItem('astudio:orientation') === 'auto' ? 'auto' : 'landscape';
  } catch {
    return 'landscape';
  }
}
export function applyOrientation(mode = orientationPref()) {
  try {
    localStorage.setItem('astudio:orientation', mode);
  } catch {
    /* ignore */
  }
  if (isNative()) AppUpdater.setOrientation({ mode }).catch(() => {});
}
