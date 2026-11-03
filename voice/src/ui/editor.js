// Vocal editor: a piano roll whose notes carry lyrics (kana, typed as letters), with
// the sung pitch curve drawn over them, ghost notes of the other tracks and the render
// state of each phrase.
import { h } from './dom.js';
import { store, PPQ, NKEYS, makeNote, drawCurve } from '../store.js';
import { normalizeLyric, kanaToRomaji } from '../lyrics.js';
import { makePhrases, pitchFn } from '../phrase.js';
import { trackPhrases } from '../render.js';
import { TRACK_COLORS } from '../store.js';
import { t } from '../i18n.js';

export const KEY_W = 46;
export const RULER_H = 22;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const isBlack = (k) => [1, 3, 6, 8, 10].includes(k % 12);

export const ui = {
  tool: 'draw', // select | draw | pitch | erase | pan
  snap: PPQ / 4,
  px: 0.12, // pixels per tick
  rowH: 17,
  sx: 0,
  sy: 0,
  sel: new Set(),
  lastLen: PPQ,
  nextLyric: 'ら',
  lane: 'dyn',
  showPitch: true,
};

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim() || '#888';

export function createEditor({ onNoteEdit, onSelect, getPlayhead, onSeek }) {
  const cv = h('canvas', { class: 'cv', 'aria-label': t('Vocal editor') });
  const head = h('canvas', { class: 'cv cv-head', 'aria-hidden': 'true' });
  const wrap = h('div', { class: 'cvwrap editor-wrap' }, cv, head);
  let W = 0;
  let H = 0;
  let dpr = 1;
  let g = null;
  let hg = null;

  const tr = () => store.track();
  const xAt = (tick) => KEY_W + tick * ui.px - ui.sx;
  const tickAt = (x) => Math.max(0, (x - KEY_W + ui.sx) / ui.px);
  const yAt = (key) => RULER_H + (NKEYS - 1 - key) * ui.rowH - ui.sy;
  const keyAt = (y) => Math.max(0, Math.min(NKEYS - 1, NKEYS - 1 - Math.floor((y - RULER_H + ui.sy) / ui.rowH)));
  const snapT = (tick) => Math.max(0, Math.floor(tick / ui.snap) * ui.snap);
  const snapR = (tick) => Math.max(0, Math.round(tick / ui.snap) * ui.snap);
  const maxSy = () => Math.max(0, NKEYS * ui.rowH - (H - RULER_H));
  const clampView = () => {
    ui.sx = Math.max(0, ui.sx);
    ui.sy = Math.max(0, Math.min(maxSy(), ui.sy));
  };

  function noteAt(x, y) {
    const k = keyAt(y);
    const tk = tickAt(x);
    const notes = tr().notes;
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.key === k && tk >= n.t && tk < n.t + n.len) {
        const edge = xAt(n.t + n.len) - x < Math.min(12, (n.len * ui.px) / 3);
        return { n, edge };
      }
    }
    return null;
  }

  function draw() {
    if (!g) return;
    const project = store.project;
    const track = tr();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = css('grid-white');
    g.fillRect(0, 0, W, H);
    // Rows
    const kTop = keyAt(RULER_H);
    const kBot = keyAt(H - 1);
    for (let k = kBot; k <= kTop; k++) {
      const y = yAt(k);
      if (isBlack(k)) {
        g.fillStyle = css('grid-black');
        g.fillRect(KEY_W, y, W - KEY_W, ui.rowH);
      }
      if (k % 12 === 0) {
        g.fillStyle = css('grid-line');
        g.fillRect(KEY_W, y + ui.rowH - 1, W - KEY_W, 1);
      }
    }
    // Columns
    const beat = PPQ;
    const bar = PPQ * project.beats;
    const t0 = tickAt(KEY_W);
    const t1 = tickAt(W);
    const step = ui.snap * ui.px >= 6 ? ui.snap : beat * ui.px >= 6 ? beat : bar;
    for (let tk = Math.floor(t0 / step) * step; tk <= t1; tk += step) {
      const x = Math.round(xAt(tk));
      g.fillStyle = tk % bar === 0 ? css('bar-line') : css('grid-line');
      g.globalAlpha = tk % bar === 0 ? 1 : tk % beat === 0 ? 0.9 : 0.45;
      g.fillRect(x, RULER_H, 1, H - RULER_H);
    }
    g.globalAlpha = 1;
    // Ghost notes of the other tracks
    for (const other of project.tracks) {
      if (other.id === track.id) continue;
      g.fillStyle = TRACK_COLORS[other.color % TRACK_COLORS.length];
      g.globalAlpha = 0.22;
      for (const n of other.notes) {
        const x = xAt(n.t);
        const w = n.len * ui.px;
        if (x > W || x + w < KEY_W) continue;
        g.fillRect(x, yAt(n.key) + 3, w, ui.rowH - 6);
      }
    }
    g.globalAlpha = 1;
    // Notes of the track
    const noteCol = TRACK_COLORS[track.color % TRACK_COLORS.length];
    g.font = "600 11px system-ui, 'Noto Sans CJK JP', 'Noto Sans JP', sans-serif";
    g.textBaseline = 'middle';
    for (const n of track.notes) {
      const x = xAt(n.t);
      const w = Math.max(4, n.len * ui.px - 1);
      if (x > W || x + w < KEY_W) continue;
      const y = yAt(n.key);
      if (y > H || y + ui.rowH < RULER_H) continue;
      const sel = ui.sel.has(n.id);
      g.fillStyle = noteCol;
      roundRect(g, x, y + 1, w, ui.rowH - 2, 5);
      g.fill();
      if (sel) {
        g.strokeStyle = css('sel');
        g.lineWidth = 2;
        g.stroke();
      }
      // Velocity as a thin bar at the bottom.
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x + 3, y + ui.rowH - 4, Math.max(0, (w - 6) * (n.vel == null ? 0.8 : n.vel)), 2);
      g.save();
      g.beginPath();
      g.rect(x + 2, y, w - 4, ui.rowH);
      g.clip();
      const ly = normalizeLyric(n.lyric);
      g.fillStyle = css('note-text');
      const label = ly === '-' ? '–' : ly;
      g.fillText(label + (n.vib && n.vib.depth > 0 ? ' ∿' : ''), x + 5, y + ui.rowH / 2);
      g.restore();
      // Romaji (or phonemes) above the note when there is room.
      if (ui.rowH >= 15 && w > 22 && ly && ly !== '-' && ly !== 'R') {
        g.fillStyle = css('dim');
        g.font = '10px system-ui, sans-serif';
        g.fillText(n.ph || kanaToRomaji(ly), x + 3, y - 6);
        g.font = "600 11px system-ui, 'Noto Sans CJK JP', 'Noto Sans JP', sans-serif";
      }
    }
    // Pitch curve of what will be sung
    if (ui.showPitch && track.notes.length) {
      g.strokeStyle = css('pitch');
      g.lineWidth = 1.6;
      for (const ph of makePhrases(track, project)) {
        const f = pitchFn(ph.notes, track, project.bpm);
        const s0 = ph.notes[0].start;
        const s1 = ph.notes[ph.notes.length - 1].end;
        g.beginPath();
        let first = true;
        const xs = Math.max(KEY_W, xAt((s0 * project.bpm * PPQ) / 60));
        const xe = Math.min(W, xAt((s1 * project.bpm * PPQ) / 60));
        for (let x = xs; x <= xe; x += 3) {
          const tsec = (tickAt(x) / PPQ) * (60 / project.bpm);
          const m = f(tsec);
          const y = yAt(m) + ui.rowH / 2;
          if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y);
        }
        g.stroke();
      }
    }
    // Keys
    g.fillStyle = css('panel');
    g.fillRect(0, RULER_H, KEY_W, H - RULER_H);
    for (let k = kBot; k <= kTop; k++) {
      const y = yAt(k);
      g.fillStyle = isBlack(k) ? '#2b2b33' : '#e9e9ef';
      g.fillRect(isBlack(k) ? 0 : 0, y, isBlack(k) ? KEY_W * 0.62 : KEY_W - 1, ui.rowH - 1);
      if (k % 12 === 0) {
        g.fillStyle = '#555';
        g.font = '10px system-ui, sans-serif';
        g.fillText(NAMES[0] + (k / 12 - 1), KEY_W - 26, y + ui.rowH / 2);
      }
    }
    // Ruler with bars and the render state of each phrase
    g.fillStyle = css('panel2');
    g.fillRect(0, 0, W, RULER_H);
    g.fillStyle = css('dim');
    g.font = '11px system-ui, sans-serif';
    for (let tk = Math.floor(t0 / bar) * bar; tk <= t1; tk += bar) {
      const x = Math.round(xAt(tk));
      if (x < KEY_W - 1) continue;
      g.fillRect(x, 8, 1, RULER_H - 8);
      g.fillText(String(tk / bar + 1), x + 4, 12);
    }
    for (const p of trackPhrases(track, project)) {
      const xa = Math.max(KEY_W, xAt((p.ph.notes[0].start * project.bpm * PPQ) / 60));
      const xb = Math.min(W, xAt((p.ph.notes[p.ph.notes.length - 1].end * project.bpm * PPQ) / 60));
      if (xb <= xa) continue;
      g.fillStyle = p.result ? (p.result.error ? css('danger') : css('accent2')) : css('line');
      g.fillRect(xa, RULER_H - 4, xb - xa, 3);
    }
    g.fillStyle = css('line');
    g.fillRect(0, RULER_H - 1, W, 1);
    drawHead();
  }

  function drawHead() {
    if (!hg) return;
    hg.setTransform(dpr, 0, 0, dpr, 0, 0);
    hg.clearRect(0, 0, W, H);
    const sec = getPlayhead();
    const x = Math.round(xAt((sec * store.project.bpm * PPQ) / 60));
    if (x < KEY_W || x > W) return;
    hg.fillStyle = css('accent');
    hg.fillRect(x, 0, 2, H);
  }

  function roundRect(c, x, y, w, hh, r) {
    const rr = Math.min(r, w / 2, hh / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + hh, rr);
    c.arcTo(x + w, y + hh, x, y + hh, rr);
    c.arcTo(x, y + hh, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  // Pointers: one finger edits with the tool, two fingers pan and zoom.
  const ptrs = new Map();
  let st = null;
  let lastTap = { at: 0, id: null };
  let pinch = null;

  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, pos(e));
    if (ptrs.size === 2) {
      // Cancel the one-finger action and start a pinch.
      if (st && st.committed) store.undo();
      st = null;
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, px: ui.px, sx: ui.sx, sy: ui.sy };
      return;
    }
    if (ptrs.size > 2) return;
    const p = pos(e);
    st = { p0: p, last: p, moved: false, button: e.button, t0: performance.now() };
    if (p.y < RULER_H) {
      st.mode = 'seek';
      onSeek(((tickAt(p.x) / PPQ) * 60) / store.project.bpm);
      return;
    }
    if (p.x < KEY_W) {
      st.mode = 'scroll';
      return;
    }
    const tool = e.button === 1 ? 'pan' : ui.tool;
    const hit = noteAt(p.x, p.y);
    if (tool === 'pan') st.mode = 'pan';
    else if (tool === 'erase' || e.button === 2) {
      st.mode = 'erase';
      store.commit();
      st.committed = true;
      eraseAt(p);
    } else if (tool === 'pitch') {
      st.mode = 'pitch';
      store.commit();
      st.committed = true;
      pitchDraw(p, p);
    } else if (hit) {
      st.hit = hit;
      st.mode = hit.edge ? 'resize' : 'move';
      if (!ui.sel.has(hit.n.id)) {
        if (!e.shiftKey) ui.sel.clear();
        ui.sel.add(hit.n.id);
        onSelect();
      }
      st.orig = tr().notes.filter((n) => ui.sel.has(n.id)).map((n) => ({ n, t: n.t, key: n.key, len: n.len }));
    } else if (tool === 'select') {
      st.mode = 'box';
    } else {
      st.mode = 'create';
    }
    draw();
  });

  cv.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, pos(e));
    if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const k = Math.max(0.02, Math.min(1.2, pinch.px * (d / Math.max(10, pinch.d))));
      const tickUnder = (pinch.cx - KEY_W + pinch.sx) / pinch.px;
      ui.px = k;
      ui.sx = tickUnder * k - (cx - KEY_W);
      ui.sy = pinch.sy - (cy - pinch.cy);
      clampView();
      draw();
      return;
    }
    if (!st) return;
    const p = pos(e);
    const dx = p.x - st.p0.x;
    const dy = p.y - st.p0.y;
    if (!st.moved && Math.hypot(dx, dy) > 6) st.moved = true;
    const track = tr();
    if (st.mode === 'seek') onSeek(((tickAt(p.x) / PPQ) * 60) / store.project.bpm);
    else if (st.mode === 'scroll' || st.mode === 'pan') {
      ui.sy -= p.y - st.last.y;
      if (st.mode === 'pan') ui.sx -= p.x - st.last.x;
      clampView();
      draw();
    } else if (st.mode === 'erase') {
      eraseAt(p);
    } else if (st.mode === 'pitch') {
      pitchDraw(st.last, p);
    } else if (st.moved && (st.mode === 'move' || st.mode === 'resize')) {
      if (!st.committed) {
        store.commit();
        st.committed = true;
        // The undo snapshot holds copies: keep editing the live notes.
        st.orig = track.notes.filter((n) => ui.sel.has(n.id)).map((n) => ({ n, t: n.t, key: n.key, len: n.len }));
      }
      const dt = Math.round((dx / ui.px) / ui.snap) * ui.snap;
      const dk = Math.round(-dy / ui.rowH);
      for (const o of st.orig) {
        if (st.mode === 'move') {
          o.n.t = Math.max(0, o.t + dt);
          o.n.key = Math.max(0, Math.min(NKEYS - 1, o.key + dk));
        } else {
          o.n.len = Math.max(ui.snap, o.len + dt);
          ui.lastLen = o.n.len;
        }
      }
      draw();
    } else if (st.mode === 'create' && st.moved) {
      if (!st.note) {
        store.commit();
        st.committed = true;
        const t0 = snapT(tickAt(st.p0.x));
        st.note = makeNote(t0, keyAt(st.p0.y), ui.snap, ui.nextLyric);
        track.notes.push(st.note);
        ui.sel.clear();
        ui.sel.add(st.note.id);
      }
      st.note.len = Math.max(ui.snap, snapR(tickAt(p.x)) - st.note.t);
      ui.lastLen = st.note.len;
      draw();
    } else if (st.mode === 'box' && st.moved) {
      const ta = tickAt(Math.min(st.p0.x, p.x));
      const tb = tickAt(Math.max(st.p0.x, p.x));
      const ka = keyAt(Math.max(st.p0.y, p.y));
      const kb = keyAt(Math.min(st.p0.y, p.y));
      ui.sel.clear();
      for (const n of track.notes) if (n.key >= ka && n.key <= kb && n.t < tb && n.t + n.len > ta) ui.sel.add(n.id);
      draw();
      g.strokeStyle = css('sel');
      g.setLineDash([4, 3]);
      g.strokeRect(Math.min(st.p0.x, p.x), Math.min(st.p0.y, p.y), Math.abs(dx), Math.abs(dy));
      g.setLineDash([]);
    }
    st.last = p;
  });

  const end = (e) => {
    ptrs.delete(e.pointerId);
    if (pinch) {
      if (ptrs.size < 2) pinch = null;
      return;
    }
    if (!st) return;
    const s = st;
    st = null;
    const p = pos(e);
    const track = tr();
    if (!s.moved && s.mode !== 'seek' && s.mode !== 'erase' && s.mode !== 'pitch') {
      const hit = noteAt(p.x, p.y);
      const now = performance.now();
      if (hit) {
        // Double tap on a note: edit its lyric.
        if (lastTap.id === hit.n.id && now - lastTap.at < 450) {
          lastTap = { at: 0, id: null };
          onNoteEdit(hit.n);
          return;
        }
        lastTap = { at: now, id: hit.n.id };
        if (now - s.t0 > 550) {
          onNoteEdit(hit.n, true);
          return;
        }
        ui.sel.clear();
        ui.sel.add(hit.n.id);
        onSelect();
      } else if (ui.tool === 'draw' && s.mode === 'create') {
        store.commit();
        const n = makeNote(snapT(tickAt(p.x)), keyAt(p.y), ui.lastLen, ui.nextLyric);
        track.notes.push(n);
        ui.sel.clear();
        ui.sel.add(n.id);
        onSelect();
      } else if (s.mode === 'box' || s.mode === 'create') {
        ui.sel.clear();
        onSelect();
      }
    }
    if (s.committed || s.mode === 'create' || !s.moved) {
      track.notes.sort((a, b) => a.t - b.t);
      store.emit();
    } else draw();
    if (s.mode === 'move' || s.mode === 'resize' || s.mode === 'box') onSelect();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', (e) => {
    ptrs.delete(e.pointerId);
    if (st && st.committed) store.undo();
    st = null;
    pinch = null;
    draw();
  });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const p = pos(e);
      const tickUnder = tickAt(p.x);
      ui.px = Math.max(0.02, Math.min(1.2, ui.px * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      ui.sx = tickUnder * ui.px - (p.x - KEY_W);
    } else if (e.shiftKey) ui.sx += e.deltaY;
    else {
      ui.sx += e.deltaX;
      ui.sy += e.deltaY;
    }
    clampView();
    draw();
  }, { passive: false });

  function eraseAt(p) {
    const hit = noteAt(p.x, p.y);
    if (!hit) return;
    const notes = tr().notes;
    notes.splice(notes.indexOf(hit.n), 1);
    ui.sel.delete(hit.n.id);
    draw();
  }

  // Pitch tool: the line drawn sets the pitch bend (cents from the note under it).
  function pitchDraw(a, b) {
    const track = tr();
    const base = (tick) => {
      const n = track.notes.find((x) => tick >= x.t && tick < x.t + x.len);
      return n ? n.key : null;
    };
    const ta = tickAt(a.x);
    const tb = tickAt(b.x);
    const ka = NKEYS - 1 - (a.y - RULER_H + ui.sy) / ui.rowH + 0.5;
    const kb = NKEYS - 1 - (b.y - RULER_H + ui.sy) / ui.rowH + 0.5;
    const na = base(ta);
    const nb = base(tb);
    if (na == null && nb == null) return;
    const ca = Math.round((ka - (na == null ? nb : na)) * 100);
    const cb = Math.round((kb - (nb == null ? na : nb)) * 100);
    const clamp = (v) => Math.max(-1200, Math.min(1200, v));
    track.curves.pit = drawCurve(track.curves.pit || [], Math.round(ta), clamp(ca), Math.round(tb), clamp(cb), 10);
    draw();
  }

  const ro = new ResizeObserver(() => fit());
  ro.observe(wrap);
  let centred = false;
  function fit() {
    const r = wrap.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width;
    H = r.height;
    for (const c of [cv, head]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.width = W + 'px';
      c.style.height = H + 'px';
    }
    g = cv.getContext('2d');
    hg = head.getContext('2d');
    if (!centred) {
      // Start around C4 to C5, or around the notes of the track.
      const notes = tr().notes;
      const k = notes.length ? Math.round(notes.reduce((s, n) => s + n.key, 0) / notes.length) : 66;
      ui.sy = (NKEYS - 1 - k) * ui.rowH - (H - RULER_H) / 2;
      centred = true;
    }
    clampView();
    draw();
  }

  return {
    el: wrap,
    draw,
    drawHead,
    zoom(f) {
      const mid = tickAt((KEY_W + W) / 2);
      ui.px = Math.max(0.02, Math.min(1.2, ui.px * f));
      ui.sx = mid * ui.px - (W - KEY_W) / 2;
      clampView();
      draw();
    },
    follow(sec) {
      const x = xAt((sec * store.project.bpm * PPQ) / 60);
      if (x > W - 40 || x < KEY_W) {
        ui.sx += x - KEY_W - 40;
        clampView();
        draw();
      }
    },
    centreOn(key) {
      ui.sy = (NKEYS - 1 - key) * ui.rowH - (H - RULER_H) / 2;
      clampView();
      draw();
    },
  };
}
