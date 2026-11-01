/* global __APP_VERSION__, __APP_BUILD__ */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';
export const APP_BUILD = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 0;

export const REPO = 'kurodaki-dev/A-studio';
export const LATEST_URL = 'https://api.github.com/repos/' + REPO + '/releases/latest';
export const APK_NAME = 'A-Studio.apk';

// "v1.0.12" -> 12. Returns 0 when the tag has no build number.
export function buildFromTag(tag) {
  const m = /(\d+)\s*$/.exec(String(tag || ''));
  return m ? Number(m[1]) : 0;
}

// Reads a GitHub "latest release" response. Returns null when nothing usable is newer.
export function newerRelease(release, currentBuild) {
  if (!release || release.draft || release.prerelease) return null;
  const build = buildFromTag(release.tag_name);
  if (!build || build <= currentBuild) return null;
  const asset = (release.assets || []).find((a) => a && a.name === APK_NAME);
  if (!asset || typeof asset.browser_download_url !== 'string') return null;
  if (!asset.browser_download_url.startsWith('https://github.com/' + REPO + '/releases/download/')) return null;
  return {
    build,
    version: String(release.tag_name).replace(/^v/, ''),
    notes: typeof release.body === 'string' ? release.body : '',
    url: asset.browser_download_url,
    size: typeof asset.size === 'number' ? asset.size : 0,
  };
}
