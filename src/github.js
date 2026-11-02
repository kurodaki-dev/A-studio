// Install plugins and themes from a GitHub link. Only github.com and
// raw.githubusercontent.com are contacted, and only when the user asks.
const API = 'https://api.github.com/repos/';
const RAW = 'https://raw.githubusercontent.com/';
const MAX_FILE = 256 * 1024;
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

export const isPluginFile = (name) => /\.astudio-plugin\.js$/i.test(name);
export const isThemeFile = (name) => /\.astudio-theme\.json$/i.test(name);

// Accepted links:
//   github.com/owner/repo                      repository (default branch, root and plugins/ folder)
//   github.com/owner/repo/tree/ref/path        folder
//   github.com/owner/repo/blob/ref/path/file   file
//   raw.githubusercontent.com/owner/repo/ref/path/file
export function parseGithubUrl(input) {
  let url;
  try {
    url = new URL(String(input || '').trim().replace(/^(?!https?:\/\/)/, 'https://'));
  } catch {
    throw new Error('Not a valid link');
  }
  if (url.protocol !== 'https:') throw new Error('The link must use https');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const host = url.hostname.toLowerCase();
  const check = (owner, repo) => {
    if (!NAME.test(owner) || !NAME.test(repo) || /^\.+$/.test(owner) || /^\.+$/.test(repo)) throw new Error('Not a GitHub repository link');
  };
  if (host === 'raw.githubusercontent.com') {
    if (parts.length < 4) throw new Error('Incomplete raw link');
    const [owner, repo, ref, ...path] = parts;
    check(owner, repo);
    return { kind: 'file', owner, repo, ref, path: path.join('/') };
  }
  if (host !== 'github.com' && host !== 'www.github.com') throw new Error('Only github.com links are supported');
  if (parts.length < 2) throw new Error('The link must point to a repository');
  const [owner, rawRepo, mode, ref, ...path] = parts;
  const repo = rawRepo.replace(/\.git$/, '');
  check(owner, repo);
  if (!mode) return { kind: 'dir', owner, repo, ref: null, path: '' };
  if ((mode === 'tree' || mode === 'blob') && ref) return { kind: mode === 'blob' ? 'file' : 'dir', owner, repo, ref, path: path.join('/') };
  throw new Error('Use a link to a repository, a folder or a file');
}

export function rawUrl(info) {
  return RAW + [info.owner, info.repo, info.ref, ...info.path.split('/')].map(encodeURIComponent).join('/');
}

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  if (res.status === 404) throw new Error('Repository or folder not found (it must be public)');
  if (res.status === 403) throw new Error('GitHub refused the request (rate limit). Try again later.');
  if (!res.ok) throw new Error('GitHub error ' + res.status);
  return res.json();
}

// Download a text file from raw.githubusercontent.com.
export async function fetchText(url) {
  if (!String(url).startsWith(RAW)) throw new Error('Only raw.githubusercontent.com files can be downloaded');
  const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  if (!res.ok) throw new Error('Download failed (' + res.status + ')');
  const text = await res.text();
  if (text.length > MAX_FILE) throw new Error('The file is larger than 256 KB');
  return text;
}

async function listDir(info, path) {
  const q = info.ref ? '?ref=' + encodeURIComponent(info.ref) : '';
  const enc = path ? '/' + path.split('/').map(encodeURIComponent).join('/') : '';
  const items = await getJson(API + encodeURIComponent(info.owner) + '/' + encodeURIComponent(info.repo) + '/contents' + enc + q);
  if (!Array.isArray(items)) return [];
  return items
    .filter((x) => x && x.type === 'file' && typeof x.download_url === 'string' && x.download_url.startsWith(RAW) && (isPluginFile(x.name) || isThemeFile(x.name)))
    .map((x) => ({ name: x.name, path: x.path, kind: isPluginFile(x.name) ? 'plugin' : 'theme', url: x.download_url }));
}

// Returns the plugin and theme files a link points to.
export async function findFiles(input) {
  const info = parseGithubUrl(input);
  if (info.kind === 'file') {
    const name = info.path.split('/').pop();
    if (!isPluginFile(name) && !isThemeFile(name)) throw new Error('The file must end with .astudio-plugin.js or .astudio-theme.json');
    return [{ name, path: info.path, kind: isPluginFile(name) ? 'plugin' : 'theme', url: rawUrl(info) }];
  }
  let files = await listDir(info, info.path);
  if (!files.length && !info.path) files = await listDir(info, 'plugins').catch(() => []);
  if (!files.length) throw new Error('No .astudio-plugin.js or .astudio-theme.json file found at this link');
  return files;
}

// Plugin catalog hosted in the A Studio repository.
export const CATALOG_URL = RAW + 'kurodaki-dev/A-studio/main/public/plugins/catalog.json';

export async function fetchCatalog() {
  const data = JSON.parse(await fetchText(CATALOG_URL));
  const clean = (x, kind) =>
    x && typeof x.id === 'string' && /^[a-z0-9-]{1,40}$/.test(x.id) && typeof x.url === 'string' && x.url.startsWith(RAW)
      ? { id: x.id, kind, type: kind === 'theme' ? 'theme' : ['instrument', 'effect', 'extension'].includes(x.type) ? x.type : 'instrument', name: String(x.name || x.id).slice(0, 40), author: String(x.author || '').slice(0, 60), description: String(x.description || '').slice(0, 200), url: x.url, name_: x.url.split('/').pop() }
      : null;
  return [
    ...(Array.isArray(data.plugins) ? data.plugins : []).map((x) => clean(x, 'plugin')),
    ...(Array.isArray(data.themes) ? data.themes : []).map((x) => clean(x, 'theme')),
  ].filter(Boolean);
}
