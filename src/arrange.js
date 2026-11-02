// Song arrangement helpers (they change the project; the caller commits).
import { BAR, TRACKS, PATTERN_COLORS } from './constants.js';
import { clipLength, makePattern, nextPatternIndex, newId } from './store.js';

// Insert `len` ticks of silence at `at`: everything that starts at or after it moves right.
// A clip that crosses `at` gets longer, like FL Studio's insert space.
export function insertTime(project, at, len = BAR) {
  for (const c of project.playlist.clips) {
    if (c.start >= at) c.start += len;
    else if (c.start + clipLength(project, c) > at && c.type === 'auto') c.len = clipLength(project, c) + len;
  }
  for (const m of project.markers || []) if (m.t >= at) m.t += len;
  const lp = project.loop;
  if (lp) {
    if (lp.start >= at) lp.start += len;
    if (lp.end > at) lp.end += len;
  }
}

// Remove the time range [at, at + len): clips inside are deleted, clips after move
// left and clips crossing the range are shortened.
export function deleteTime(project, at, len = BAR) {
  const end = at + len;
  const keep = [];
  for (const c of project.playlist.clips) {
    const cl = clipLength(project, c);
    const cEnd = c.start + cl;
    if (c.start >= at && cEnd <= end) continue;
    if (c.start >= end) c.start -= len;
    else if (c.start < at && cEnd > at) c.len = Math.max(1, cl - (Math.min(cEnd, end) - at));
    else if (c.start >= at && c.start < end) {
      // Starts inside the range and goes past it: keep the part after.
      const cut = end - c.start;
      c.len = cl - cut;
      if (c.type !== 'auto') c.offset = (c.offset || 0) + cut;
      c.start = at;
    }
    keep.push(c);
  }
  project.playlist.clips = keep;
  project.markers = (project.markers || []).filter((m) => m.t < at || m.t >= end).map((m) => (m.t >= end ? { ...m, t: m.t - len } : m));
  const lp = project.loop;
  if (lp) {
    const shift = (x) => (x >= end ? x - len : x > at ? at : x);
    lp.start = shift(lp.start);
    lp.end = Math.max(lp.start + BAR / 4, shift(lp.end));
  }
}

// One new pattern per channel with notes. Playlist clips of the pattern are replaced by
// one clip per new pattern on consecutive tracks. Returns the new patterns.
export function splitByChannel(project, patId) {
  const src = project.patterns.find((p) => p.id === patId);
  if (!src) return [];
  const used = project.channels.filter((c) => (src.notes[c.id] || []).length);
  if (used.length < 2) return [];
  const created = used.map((c, i) => {
    const p = makePattern(nextPatternIndex(project) + i);
    p.name = (src.name + ' ' + c.name).slice(0, 80);
    p.color = (src.color + i) % PATTERN_COLORS.length;
    p.minBars = src.minBars;
    if (src.swing) p.swing = src.swing;
    p.notes[c.id] = src.notes[c.id].map((n) => ({ ...n }));
    return p;
  });
  const at = project.patterns.indexOf(src) + 1;
  project.patterns.splice(at, 0, ...created);
  const clips = [];
  for (const c of project.playlist.clips) {
    if (c.patternId !== patId) {
      clips.push(c);
      continue;
    }
    created.forEach((p, i) => clips.push({ ...c, id: newId('k'), patternId: p.id, track: Math.min(TRACKS - 1, c.track + i), len: c.len || undefined }));
  }
  project.playlist.clips = clips.map((c) => {
    if (c.len === undefined) delete c.len;
    return c;
  });
  return created;
}
