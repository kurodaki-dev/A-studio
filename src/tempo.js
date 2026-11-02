// Tempo changes: markers with a bpm value change the tempo from their position
// in SONG mode. Between changes the tempo is constant.
import { PPQ } from './constants.js';

export function tempoChanges(project) {
  const list = [{ t: 0, bpm: project.bpm }];
  for (const m of project.markers || []) {
    if (!Number.isFinite(m.bpm)) continue;
    if (m.t <= 0) list[0] = { t: 0, bpm: m.bpm };
    else list.push({ t: m.t, bpm: m.bpm });
  }
  return list.sort((a, b) => a.t - b.t);
}

export function bpmAt(project, tick, mode = 'song') {
  if (mode !== 'song') return project.bpm;
  let bpm = project.bpm;
  for (const c of tempoChanges(project)) if (c.t <= tick) bpm = c.bpm;
  return bpm;
}

// First tempo change strictly after tick (Infinity when none).
export function nextTempoChange(project, tick, mode = 'song') {
  if (mode !== 'song') return Infinity;
  for (const c of tempoChanges(project)) if (c.t > tick) return c.t;
  return Infinity;
}

// Seconds from tick 0 to tick, following the tempo changes.
export function tickToSec(project, tick, mode = 'song') {
  const ch = mode === 'song' ? tempoChanges(project) : [{ t: 0, bpm: project.bpm }];
  let sec = 0;
  for (let i = 0; i < ch.length; i++) {
    const a = ch[i].t;
    if (a >= tick) break;
    const b = Math.min(tick, i + 1 < ch.length ? ch[i + 1].t : Infinity);
    sec += (b - a) * (60 / (ch[i].bpm * PPQ));
  }
  return sec;
}
