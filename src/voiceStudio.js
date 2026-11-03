// A Voice Studio: the vocal synthesis extension (DiffSinger, UTAU / OpenUTAU, VOICEVOX).
// The switch above the menu bar opens it.
// - Android: it is a separate extension APK (no icon in the app drawer). If it is not
//   installed yet, A Studio offers to download it from the latest GitHub release.
// - Web: it is published next to A Studio, in the voice/ folder of the site.
import { h, openModal, alertBox } from './ui/dom.js';
import { isNative } from './platform.js';
import { REPO } from './version.js';
import { AppUpdater, fetchLatest, installUpdate } from './update.js';
import { t, fmtNum } from './i18n.js';

export const VOICE_PACKAGE = 'com.kurodaki.avoicestudio';
export const VOICE_APK = 'A-Voice-Studio.apk';

// Download link of the extension in a GitHub release response, or null.
export function voiceAsset(release) {
  const a = release && (release.assets || []).find((x) => x && x.name === VOICE_APK);
  if (!a || typeof a.browser_download_url !== 'string') return null;
  if (!a.browser_download_url.startsWith('https://github.com/' + REPO + '/releases/download/')) return null;
  return { url: a.browser_download_url, size: typeof a.size === 'number' ? a.size : 0, version: String(release.tag_name || '').replace(/^v/, '') };
}

async function offerInstall() {
  let asset = null;
  try {
    asset = voiceAsset(await fetchLatest());
  } catch {
    asset = null;
  }
  if (!asset) {
    alertBox('A Voice Studio', t('A Voice Studio is not installed and could not be found online. Check your connection, or download A-Voice-Studio.apk from the A Studio releases on GitHub.'));
    return;
  }
  openModal({
    title: 'A Voice Studio',
    body: h('div', null,
      h('p', null, t('A Voice Studio is the vocal extension of A Studio: DiffSinger, UTAU / OpenUTAU and VOICEVOX voices, with lyrics typed in letters.')),
      h('p', null, t('It is installed apart (an extension, without its own icon) and opens from this switch.') + (asset.size ? ' (' + fmtNum(asset.size / 1048576) + t(' MB)') : '')),
    ),
    actions: [
      { label: t('Later') },
      { label: t('Install A Voice Studio'), primary: true, onClick: () => { installUpdate(asset, { title: 'A Voice Studio', done: t('Confirm the install in the Android window, then tap the A Voice Studio switch again.') }); } },
    ],
  });
}

export async function openVoiceStudio() {
  if (!isNative()) {
    window.location.href = new URL('voice/', window.location.href).href;
    return;
  }
  try {
    const { installed } = await AppUpdater.extensionInstalled();
    if (installed) {
      await AppUpdater.openExtension();
      return;
    }
  } catch {
    /* older app without the bridge: offer the download */
  }
  offerInstall();
}
