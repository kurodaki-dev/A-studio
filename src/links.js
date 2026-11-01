import { isNative } from './platform.js';
import { APP_VERSION, REPO } from './version.js';

export const DOCS_URL = 'https://kurodaki-dev.github.io/A-studio/doc/';
export const REPO_URL = 'https://github.com/' + REPO;

export function bugReportUrl() {
  return REPO_URL + '/issues/new?template=bug_report.yml&version=' + encodeURIComponent(APP_VERSION);
}

// Open a web page outside the app (system browser on Android, new tab on the web).
export function openExternal(url) {
  if (isNative()) window.location.href = url;
  else window.open(url, '_blank', 'noopener');
}
