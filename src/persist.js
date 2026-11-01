import { serialize } from './store.js';

// Everything stays on the device, in the app's local storage.
const KEY_CURRENT = 'astudio:current';
const KEY_LIBRARY = 'astudio:projects';

function read(key) {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export function loadCurrent() {
  return read(KEY_CURRENT);
}

export function saveCurrent(project) {
  try {
    localStorage.setItem(KEY_CURRENT, serialize(project));
  } catch {
    /* storage full or unavailable */
  }
}

function library() {
  const lib = read(KEY_LIBRARY);
  return lib && typeof lib === 'object' ? lib : {};
}

export function listProjects() {
  return Object.entries(library())
    .map(([name, v]) => ({ name, savedAt: v.savedAt || 0 }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function saveProject(project) {
  const lib = library();
  lib[project.name] = { savedAt: Date.now(), data: JSON.parse(serialize(project)) };
  localStorage.setItem(KEY_LIBRARY, JSON.stringify(lib));
}

export function loadProject(name) {
  const e = library()[name];
  return e ? e.data : null;
}

export function deleteProject(name) {
  const lib = library();
  delete lib[name];
  try {
    localStorage.setItem(KEY_LIBRARY, JSON.stringify(lib));
  } catch {
    /* ignore */
  }
}
