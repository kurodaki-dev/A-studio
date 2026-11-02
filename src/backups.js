// Automatic backups of the open project: a snapshot every few minutes of work,
// the last 12 kept in local storage. Restoring one opens it as the current project.
import { serialize } from './store.js';

const KEY = 'astudio:backups';
const MAX = 12;
const EVERY = 5 * 60 * 1000;

export function listBackups() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((b) => b && typeof b.data === 'string') : [];
  } catch {
    return [];
  }
}

let last = 0;
let lastData = '';
export function maybeBackup(project, force = false) {
  const now = Date.now();
  if (!force && now - last < EVERY) return false;
  const data = serialize(project);
  if (data === lastData) return false;
  last = now;
  lastData = data;
  let list = listBackups();
  list.push({ at: now, name: project.name, data });
  list = list.slice(-MAX);
  // Drop the oldest until it fits.
  while (list.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch {
      list.shift();
    }
  }
  return false;
}
