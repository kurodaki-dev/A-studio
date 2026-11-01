import { h, btn, icon, hint, openMenu } from './dom.js';
import { attachPointer, fitCanvas } from './pointer.js';
import { store, getPattern, patternLength, songLength, newId } from '../store.js';
import { ui } from '../ui-state.js';
import { BAR, BEAT, STEP, TRACKS, PATTERN_COLORS, clamp } from '../constants.js';

const HEAD_W = 92;
const RULER_H = 22;
const SNAPS = [
  { id: 'bar', label: 'Mesure', ticks: BAR },
  { id: 'beat', label: 'Temps', ticks: BEAT },
  { id: 'step', label: 'Pas', ticks: STEP },
];

export function createPlaylist(engine, actions) {
  const cv = h('canvas', { class: 'cv', 'aria-label': 'Playlist' });
  const wrap = h('div', { class: 'cvwrap' }, cv);
  const view = { px: 0.12, rowH: 40, sx: 0, sy: 0 };
  let W = 0;
  let H = 0;
  let dpr = 1;
  let g = null;

  const toolDefs = [
    ['draw', 'Pencil', 'Dessiner'],
    ['delete', 'Eraser', 'Supprimer'],
    ['hand', 'Hand', 'Déplacer la vue'],
  ];
  const toolBtns = toolDefs.map(([id, ic, label]) => {
    const b = btn(ic, label, () => {
      ui.plTool = id;
      hint('Outil : ' + label);
      refresh();
    });
    b.dataset.tool = id;
    return b;
  });
  const snapBtn = h('button', { class: 'b tb snap', type: 'button', title: 'Magnétisme', onClick: (e) => {
    openMenu(e.currentTarget, SNAPS.map((s) => ({ label: s.label, checked: ui.plSnap === s.id, onClick: () => { ui.plSnap = s.id; refresh(); } })));
  } }, icon('Magnet', 16), h('span', { class: 'snap-label' }));
  const patLabel = h('span', { class: 'rack-info' });
  const bar = h('div', { class: 'ptools' },
    h('div', { class: 'grp' }, h('span', { class: 'ptitle' }, 'Playlist'), patLabel),
    h('div', { class: 'grp' }, toolBtns),
    h('div', { class: 'grp' }, snapBtn),
    h('div', { class: 'grp' },
      btn('ZoomOut', 'Zoom arrière', () => zoomX(1 / 1.4, HEAD_W + (W - HEAD_W) / 2)),
      btn('ZoomIn', 'Zoom avant', () => zoomX(1.4, HEAD_W + (W - HEAD_W) / 2)),
    ),
  );
  const el = h('div', { class: 'panel pl' }, bar, wrap);

  function refresh() {
    toolBtns.forEach((b) => b.classList.toggle('on', b.dataset.tool === ui.plTool));
    snapBtn.querySelector('.snap-label').textContent = (SNAPS.find((s) => s.id === ui.plSnap) || SNAPS[0]).label;
    const pat = getPattern(store.project, store.project.currentPattern);
    patLabel.textContent = pat ? 'Motif à placer : ' + pat.name : '';
  }

  const snap = () => (SNAPS.find((s) => s.id === ui.plSnap) || SNAPS[0]).ticks;
  const tickAt = (x) => (x - HEAD_W + view.sx) / view.px;
  const xAt = (t) => HEAD_W + t * view.px - view.sx;
  const trackAt = (y) => Math.floor((y - RULER_H + view.sy) / view.rowH);
  const yAt = (tr) => RULER_H + tr * view.rowH - view.sy;

  function clampView() {
    view.sx = Math.max(0, view.sx);
    view.sy = clamp(view.sy, 0, Math.max(0, TRACKS * view.rowH - (H - RULER_H)));
  }

  function clipAt(p) {
    const tr = trackAt(p.y);
    const t = tickAt(p.x);
    const clips = store.project.playlist.clips;
    for (let i = clips.length - 1; i >= 0; i--) {
      const c = clips[i];
      if (c.track !== tr) continue;
      const pat = getPattern(store.project, c.patternId);
      if (pat && t >= c.start && t < c.start + patternLength(pat)) return c;
    }
    return null;
  }

  function draw() {
    if (!g) return;
    const p = store.project;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#262e32';
    g.fillRect(0, 0, W, H);
    const t0 = Math.max(0, tickAt(HEAD_W));
    const t1 = tickAt(W);
    g.save();
    g.beginPath();
    g.rect(HEAD_W, RULER_H, W - HEAD_W, H - RULER_H);
    g.clip();
    for (let tr = 0; tr < TRACKS; tr++) {
      const y = yAt(tr);
      if (y > H || y + view.rowH < RULER_H) continue;
      g.fillStyle = tr % 2 ? '#2f3a3f' : '#344147';
      g.fillRect(HEAD_W, y, W - HEAD_W, view.rowH);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(HEAD_W, y + view.rowH - 1, W - HEAD_W, 1);
    }
    const beatPx = BEAT * view.px;
    const inc = beatPx >= 8 ? BEAT : BAR;
    for (let t = Math.floor(t0 / inc) * inc; t <= t1; t += inc) {
      g.fillStyle = t % BAR === 0 ? '#161c1f' : 'rgba(0,0,0,0.25)';
      g.fillRect(Math.round(xAt(t)), RULER_H, 1, H - RULER_H);
    }
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (const c of p.playlist.clips) {
      const pat = getPattern(p, c.patternId);
      if (!pat) continue;
      const L = patternLength(pat);
      const x = xAt(c.start);
      const w = L * view.px;
      const y = yAt(c.track);
      if (x > W || x + w < HEAD_W || y > H || y + view.rowH < RULER_H) continue;
      const muted = p.playlist.tracks[c.track] && p.playlist.tracks[c.track].mute;
      const col = PATTERN_COLORS[pat.color % PATTERN_COLORS.length];
      g.globalAlpha = muted ? 0.4 : 1;
      g.fillStyle = '#1a2023';
      g.fillRect(x, y + 1, w, view.rowH - 2);
      g.fillStyle = col;
      g.fillRect(x + 1, y + 2, w - 2, view.rowH - 4);
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(x + 1, y + 2, w - 2, 13);
      g.save();
      g.beginPath();
      g.rect(x + 1, y + 2, Math.max(0, w - 2), view.rowH - 4);
      g.clip();
      g.fillStyle = '#f2f4f5';
      g.fillText(pat.name, x + 4, y + 9);
      let lo = Infinity;
      let hi = -Infinity;
      for (const arr of Object.values(pat.notes)) for (const n of arr) { lo = Math.min(lo, n.key); hi = Math.max(hi, n.key); }
      if (lo <= hi) {
        const span = Math.max(12, hi - lo + 1);
        const base = (lo + hi) / 2 - span / 2;
        const top = y + 16;
        const hh = view.rowH - 20;
        g.fillStyle = 'rgba(15,20,22,0.75)';
        for (const arr of Object.values(pat.notes)) {
          for (const n of arr) {
            if (n.t >= L) continue;
            const nx = x + n.t * view.px;
            const ny = top + hh - ((n.key - base + 1) / span) * hh;
            g.fillRect(nx, ny, Math.max(1, n.len * view.px - 1), Math.max(1.5, hh / span));
          }
        }
      }
      g.restore();
      g.globalAlpha = 1;
    }
    if (ui.songMode && (engine.playing || engine.pos > 0)) {
      g.fillStyle = '#f0993a';
      g.fillRect(Math.round(xAt(engine.position())), RULER_H, 1, H - RULER_H);
    }
    g.restore();

    // Ruler
    g.fillStyle = '#2b3337';
    g.fillRect(0, 0, W, RULER_H);
    g.save();
    g.beginPath();
    g.rect(HEAD_W, 0, W - HEAD_W, RULER_H);
    g.clip();
    const barPx = BAR * view.px;
    const every = barPx < 26 ? Math.ceil(26 / barPx) : 1;
    for (let b = Math.floor(t0 / BAR); b * BAR < t1; b++) {
      const x = Math.round(xAt(b * BAR));
      g.fillStyle = '#5d6a70';
      g.fillRect(x, 10, 1, RULER_H - 10);
      if (b % every === 0) {
        g.fillStyle = '#aab6bb';
        g.fillText(String(b + 1), x + 4, 9);
      }
    }
    const end = songLength(p);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(Math.max(HEAD_W, xAt(end)), 0, W, RULER_H);
    if (ui.songMode && (engine.playing || engine.pos > 0)) {
      const x = Math.round(xAt(engine.position()));
      g.fillStyle = '#f0993a';
      g.beginPath();
      g.moveTo(x - 5, RULER_H - 8);
      g.lineTo(x + 5, RULER_H - 8);
      g.lineTo(x, RULER_H - 1);
      g.closePath();
      g.fill();
    }
    g.restore();
    g.fillStyle = '#151a1d';
    g.fillRect(0, RULER_H - 1, W, 1);

    // Track headers
    g.save();
    g.beginPath();
    g.rect(0, RULER_H, HEAD_W, H - RULER_H);
    g.clip();
    for (let tr = 0; tr < TRACKS; tr++) {
      const y = yAt(tr);
      if (y > H || y + view.rowH < RULER_H) continue;
      const t = p.playlist.tracks[tr];
      g.fillStyle = '#3a454b';
      g.fillRect(0, y, HEAD_W, view.rowH);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, y + view.rowH - 1, HEAD_W, 1);
      g.fillStyle = t.mute ? '#3b4448' : '#8fcf6a';
      g.fillRect(8, y + view.rowH / 2 - 5, 10, 10);
      g.fillStyle = t.mute ? '#7c878c' : '#d5dcdf';
      g.fillText(t.name, 26, y + view.rowH / 2);
    }
    g.restore();
    g.fillStyle = '#151a1d';
    g.fillRect(HEAD_W - 1, RULER_H, 1, H - RULER_H);
    g.fillStyle = '#2b3337';
    g.fillRect(0, 0, HEAD_W, RULER_H);
  }

  function placeClip(p) {
    const proj = store.project;
    const tr = trackAt(p.y);
    if (tr < 0 || tr >= TRACKS) return null;
    const clip = { id: newId('k'), patternId: proj.currentPattern, track: tr, start: Math.max(0, Math.floor(tickAt(p.x) / snap()) * snap()) };
    proj.playlist.clips.push(clip);
    return clip;
  }

  function removeClip(c) {
    const arr = store.project.playlist.clips;
    const i = arr.indexOf(c);
    if (i >= 0) arr.splice(i, 1);
  }

  function regionAt(p) {
    if (p.y < RULER_H) return p.x < HEAD_W ? 'corner' : 'ruler';
    if (p.x < HEAD_W) return 'head';
    return 'grid';
  }

  attachPointer(cv, {
    down(p, st) {
      st.region = regionAt(p);
      if (st.region === 'ruler') seek(p);
      if (st.region === 'grid' && (ui.plTool === 'delete' || st.button === 2)) {
        store.commit();
        st.committed = true;
        st.erasing = true;
        const c = clipAt(p);
        if (c) {
          removeClip(c);
          store.emit();
        }
      }
    },
    tap(p, st) {
      if (st.region === 'head') {
        const tr = trackAt(p.y);
        const t = store.project.playlist.tracks[tr];
        if (t) store.change(() => { t.mute = !t.mute; });
        return;
      }
      if (st.region !== 'grid' || st.erasing || ui.plTool !== 'draw') return;
      const c = clipAt(p);
      if (c) {
        store.project.currentPattern = c.patternId;
        hint('Motif sélectionné : ' + getPattern(store.project, c.patternId).name);
        store.emit();
      } else {
        store.commit();
        if (!placeClip(p)) store.undoStack.pop();
        store.emit();
      }
    },
    dragStart(p0, p, st) {
      if (st.region === 'ruler') return;
      if (st.region !== 'grid' || st.erasing) return;
      if (ui.plTool === 'hand') {
        st.mode = 'pan';
        return;
      }
      if (ui.plTool !== 'draw') return;
      store.commit();
      st.committed = true;
      let c = clipAt(p0);
      if (!c) c = placeClip(p0);
      if (!c) return;
      st.mode = 'move';
      st.clip = c;
      st.start0 = c.start;
      st.track0 = c.track;
      store.emit();
    },
    dragMove(p, st) {
      if (st.region === 'ruler') return seek(p);
      if (st.erasing) {
        const c = clipAt(p);
        if (c) {
          removeClip(c);
          store.emit();
        }
        return;
      }
      if (st.mode === 'pan') {
        view.sx -= p.x - st.last.x;
        view.sy -= p.y - st.last.y;
        clampView();
        draw();
      } else if (st.mode === 'move') {
        const dt = tickAt(p.x) - tickAt(st.p0.x);
        st.clip.start = Math.max(0, Math.round((st.start0 + dt) / snap()) * snap());
        st.clip.track = clamp(st.track0 + trackAt(p.y) - trackAt(st.p0.y), 0, TRACKS - 1);
        store.emit();
      }
    },
    longPress(p, st) {
      if (st.region !== 'grid' || ui.plTool !== 'draw') return;
      const c = clipAt(p);
      if (c) {
        store.commit();
        removeClip(c);
        hint('Clip supprimé');
        store.emit();
      }
    },
    cancel(st) {
      if (st.committed) store.revert();
    },
    gesture(gs) {
      if (gs.axis === 'x') zoomX(gs.sx, gs.cx, true);
      else {
        const f = (gs.cy - RULER_H + view.sy) / view.rowH;
        view.rowH = clamp(view.rowH * gs.sy, 24, 90);
        view.sy = f * view.rowH - (gs.cy - RULER_H);
      }
      view.sx -= gs.dcx;
      view.sy -= gs.dcy;
      clampView();
      draw();
    },
    wheel(e, p) {
      if (e.ctrlKey) zoomX(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x);
      else if (e.shiftKey) view.sx += e.deltaY;
      else {
        view.sy += e.deltaY;
        view.sx += e.deltaX;
      }
      clampView();
      draw();
    },
  });

  function zoomX(f, cx, noDraw) {
    const t = tickAt(cx);
    view.px = clamp(view.px * f, 0.01, 1.5);
    view.sx = t * view.px - (cx - HEAD_W);
    clampView();
    if (!noDraw) draw();
  }

  function seek(p) {
    if (!ui.songMode) return;
    engine.setPosition(Math.max(0, Math.floor(tickAt(p.x) / BEAT) * BEAT));
    draw();
  }

  fitCanvas(cv, (w, hh, r) => {
    W = w;
    H = hh;
    dpr = r;
    g = cv.getContext('2d');
    clampView();
    draw();
  });

  refresh();
  return {
    el,
    update() {
      refresh();
      draw();
    },
    frame() {
      if (engine.playing && ui.songMode) draw();
    },
  };
}
