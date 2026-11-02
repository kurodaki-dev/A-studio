import { h, btn, icon, hint, openMenu, dropdown } from './dom.js';
import { attachPointer, fitCanvas } from './pointer.js';
import { registerDrop } from './dnd.js';
import { currentTheme } from '../themes.js';
import { SB, thumb, scrollAt, drawScrollbar } from './scrollbar.js';
import { createChannel, samplerChannel } from './rack.js';
import { store, currentPattern, notesOf, notesFor, patternLength, getChannel } from '../store.js';
import { ui } from '../ui-state.js';
import { BAR, BEAT, STEP, NKEYS, SNAPS, snapTicks, noteName, isBlack, clamp, NOTE_NAMES } from '../constants.js';
import { t } from '../i18n.js';
import { detectKey, SCALES, CHORDS, inScale, snapToScale, chordify, arpeggiate, strum, humanize, legato, reverseNotes, flipNotes, stretchNotes } from '../notetools.js';

const KEYS_W = 58;
const RULER_H = 22;
const VEL_H = 72;

const C = {
  bg: '#262e32',
  white: '#36444b',
  black: '#2c383e',
  rowLine: 'rgba(0,0,0,0.22)',
  octLine: '#1b2327',
  step: 'rgba(0,0,0,0.18)',
  beat: 'rgba(0,0,0,0.42)',
  bar: '#141a1d',
  barShade: 'rgba(0,0,0,0.07)',
  after: 'rgba(0,0,0,0.3)',
  ghost: 'rgba(170,190,200,0.16)',
  note: '#8fd17c',
  noteEdge: '#3f6b35',
  noteText: '#1b2a17',
  sel: '#f18b80',
  selEdge: '#7e2d26',
  selText: '#3a1210',
  play: '#f0993a',
  ruler: '#2b3337',
  rulerText: '#aab6bb',
  keyWhite: '#e6eaec',
  keyBlack: '#1b1f21',
  keyText: '#3c474c',
  velBg: '#20272a',
};

export function createPianoRoll(engine) {
  const cv = h('canvas', { class: 'cv', 'aria-label': 'Piano roll' });
  // The playhead has its own transparent layer: while playing only it is redrawn.
  const headCv = h('canvas', { class: 'cv cv-head', 'aria-hidden': 'true' });
  const wrap = h('div', { class: 'cvwrap' }, cv, headCv);
  let hg = null;
  let hdpr = 1;
  const view = { px: 1, rowH: 18, sx: 0, sy: (NKEYS - 1 - 79) * 18 };
  let W = 0; // right edge of the grid (the vertical scrollbar sits after it)
  let CW = 0;
  let H = 0;
  let dpr = 1;
  let g = null;
  let showVel = window.innerHeight > 520;
  let pressedKey = -1;
  let held = null;
  let overlay = null; // box or slice preview

  // Toolbar
  const chanSel = dropdown({ options: [], value: null, label: t('Channel'), cls: 'chan-dd', onChange: (v) => { ui.prChannel = v; clearSel(); store.emit(); } });
  const toolDefs = [
    ['draw', 'Pencil', t('Draw')],
    ['paint', 'Paintbrush', t('Paint')],
    ['delete', 'Eraser', t('Delete')],
    ['select', 'SquareDashed', t('Select')],
    ['slice', 'Scissors', t('Slice')],
    ['hand', 'Hand', t('Pan view')],
  ];
  const toolBtns = toolDefs.map(([id, ic, label]) => {
    const b = btn(ic, label, () => {
      ui.prTool = id;
      hint(t('Tool: ') + label);
      refreshTools();
    });
    b.dataset.tool = id;
    return b;
  });
  const snapBtn = h('button', { class: 'b tb snap', type: 'button', title: t('Snap'), onClick: (e) => {
    openMenu(e.currentTarget, SNAPS.map((s) => ({ label: s.label, checked: ui.prSnap === s.id, onClick: () => { ui.prSnap = s.id; refreshTools(); } })));
  } }, icon('Magnet', 16), h('span', { class: 'snap-label' }));
  const scaleBtn = h('button', { class: 'b tb snap', type: 'button', title: t('Scale highlighting'), onClick: (e) => scaleMenu(e.currentTarget) }, icon('Music', 16), h('span', { class: 'scale-label' }));
  const velBtn = btn('AudioLines', t('Show velocities'), () => { showVel = !showVel; refreshTools(); draw(); });

  const bar = h('div', { class: 'ptools' },
    h('div', { class: 'grp' }, chanSel),
    h('div', { class: 'grp' }, toolBtns),
    h('div', { class: 'grp' }, snapBtn),
    h('div', { class: 'grp' },
      btn('Copy', t('Copy'), () => copySel()),
      btn('ClipboardPaste', t('Paste'), () => paste()),
      btn('CopyPlus', t('Duplicate'), () => duplicate()),
      btn('Trash', t('Delete selection'), () => deleteSel()),
      btn('ArrowUp', t('Up one semitone'), () => transpose(1)),
      btn('ArrowDown', t('Down one semitone'), () => transpose(-1)),
      btn('WandSparkles', t('Tools'), (e) => toolsMenu(e.currentTarget)),
      btn('Menu', t('More actions'), (e) => moreMenu(e.currentTarget)),
    ),
    h('div', { class: 'grp' }, scaleBtn),
    h('div', { class: 'grp' },
      btn('ZoomOut', t('Zoom out'), () => zoomX(1 / 1.4, gridX0() + (W - KEYS_W) / 2)),
      btn('ZoomIn', t('Zoom in'), () => zoomX(1.4, gridX0() + (W - KEYS_W) / 2)),
      velBtn,
    ),
  );
  const el = h('div', { class: 'panel pr' }, bar, wrap);

  function refreshTools() {
    toolBtns.forEach((b) => b.classList.toggle('on', b.dataset.tool === ui.prTool));
    snapBtn.querySelector('.snap-label').textContent = (SNAPS.find((s) => s.id === ui.prSnap) || SNAPS[5]).label;
    velBtn.classList.toggle('on', showVel);
    const sc = scaleOf();
    scaleBtn.querySelector('.scale-label').textContent = sc.type === 'none' ? t('No scale') : NOTE_NAMES[sc.root] + ' ' + t(SCALES.find((x) => x.id === sc.type).name);
    scaleBtn.classList.toggle('on', sc.type !== 'none');
  }

  const scaleOf = () => {
    const sc = store.project.scale;
    return sc && SCALES.some((x) => x.id === sc.type) ? sc : { root: 0, type: 'none' };
  };

  function refreshChannels() {
    const p = store.project;
    if (!getChannel(p, ui.prChannel)) ui.prChannel = p.channels[0] ? p.channels[0].id : null;
    const sig = p.channels.map((c) => c.id + c.name).join('|');
    if (chanSel.dataset.sig !== sig) {
      chanSel.setOptions(p.channels.map((c) => ({ value: c.id, label: c.name })), ui.prChannel);
      chanSel.dataset.sig = sig;
    } else chanSel.setValue(ui.prChannel);
  }

  // Geometry
  const gridX0 = () => KEYS_W;
  const gridY0 = () => RULER_H;
  const gridY1 = () => H - SB - (showVel ? VEL_H : 0);
  const tickAt = (x) => (x - KEYS_W + view.sx) / view.px;
  const xAt = (t) => KEYS_W + t * view.px - view.sx;
  const keyAt = (y) => NKEYS - 1 - Math.floor((y - RULER_H + view.sy) / view.rowH);
  const yAt = (k) => RULER_H + (NKEYS - 1 - k) * view.rowH - view.sy;
  const snap = () => snapTicks(ui.prSnap);
  const snapFloor = (t) => Math.floor(t / snap()) * snap();
  const snapRound = (t) => Math.round(t / snap()) * snap();
  const minLen = () => Math.max(snap(), ui.prSnap === 'none' ? 4 : 1);

  function clampView() {
    const maxY = Math.max(0, NKEYS * view.rowH - (gridY1() - gridY0()));
    view.sy = clamp(view.sy, 0, maxY);
    view.sx = Math.max(0, view.sx);
  }

  // Scrollbar geometry: horizontal under everything, vertical right of the grid.
  const hView = () => W - KEYS_W;
  const hTotal = () => Math.max((patternLength(pat()) + 2 * BAR) * view.px, view.sx + hView());
  const vView = () => gridY1() - RULER_H;
  const vTotal = () => NKEYS * view.rowH;

  function scrollbarDown(p, st) {
    const horiz = st.region === 'hscroll';
    const a = horiz ? KEYS_W : RULER_H;
    const b = horiz ? W : gridY1();
    const th = thumb(a, b, horiz ? hView() : vView(), horiz ? hTotal() : vTotal(), horiz ? view.sx : view.sy);
    const at = horiz ? p.x : p.y;
    st.grab = at >= th.pos && at <= th.pos + th.size ? at - th.pos : th.size / 2;
    scrollbarMove(p, st);
  }

  function scrollbarMove(p, st) {
    if (st.region === 'hscroll') view.sx = scrollAt(KEYS_W, W, hView(), hTotal(), p.x - st.grab);
    else view.sy = scrollAt(RULER_H, gridY1(), vView(), vTotal(), p.y - st.grab);
    clampView();
    draw();
  }

  function regionAt(p) {
    if (p.y >= H - SB) return p.x >= KEYS_W ? 'hscroll' : 'corner';
    if (p.x >= W) return p.y >= RULER_H && p.y < gridY1() ? 'vscroll' : 'corner';
    if (p.y < RULER_H) return p.x < KEYS_W ? 'corner' : 'ruler';
    if (showVel && p.y >= gridY1()) return p.x < KEYS_W ? 'corner' : 'vel';
    if (p.x < KEYS_W) return 'keys';
    return 'grid';
  }

  const channel = () => getChannel(store.project, ui.prChannel);
  const pat = () => currentPattern(store.project);
  const notes = () => (channel() ? notesOf(pat(), channel().id) : []);
  const editNotes = () => notesFor(pat(), channel().id);
  const selected = () => notes().filter((n) => n.s);
  function clearSel() {
    for (const arr of Object.values(pat().notes)) for (const n of arr) delete n.s;
  }

  function noteAt(p) {
    const k = keyAt(p.y);
    const t = tickAt(p.x);
    const arr = notes();
    for (let i = arr.length - 1; i >= 0; i--) {
      const n = arr[i];
      if (n.key === k && t >= n.t && t < n.t + n.len) {
        const right = xAt(n.t + n.len);
        const w = n.len * view.px;
        const edge = p.x >= right - Math.max(6, Math.min(14, w * 0.3));
        return { n, edge };
      }
    }
    return null;
  }

  function preview(key, vel) {
    const c = channel();
    if (c) engine.preview(c, key, vel ?? ui.lastVel, 0.3);
  }

  function drawHead() {
    if (!hg) return;
    hg.setTransform(hdpr, 0, 0, hdpr, 0, 0);
    hg.clearRect(0, 0, CW, H);
    if (ui.songMode || !(engine.playing || engine.pos > 0)) return;
    const x = Math.round(xAt(engine.heardPosition()));
    if (x < KEYS_W || x > W) return;
    hg.fillStyle = C.play;
    hg.fillRect(x, RULER_H, 1, gridY1() - RULER_H);
    hg.beginPath();
    hg.moveTo(x - 5, RULER_H - 8);
    hg.lineTo(x + 5, RULER_H - 8);
    hg.lineTo(x, RULER_H - 1);
    hg.closePath();
    hg.fill();
  }

  // Drawing
  function draw() {
    drawMain();
    drawHead();
  }

  function drawMain() {
    if (!g) return;
    const th = currentTheme();
    const E = th.editor;
    C.bg = th.colors.panel;
    C.white = E.gridWhite;
    C.black = E.gridBlack;
    C.note = E.note;
    C.sel = E.noteSelected;
    C.play = E.playhead;
    C.ruler = E.ruler;
    C.rulerText = th.colors.dim;
    C.velBg = th.colors.input;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
    const gx = KEYS_W;
    const gy = RULER_H;
    const gb = gridY1();
    const pat0 = pat();
    const plen = patternLength(pat0);
    const kTop = clamp(keyAt(gy), 0, NKEYS - 1);
    const kBot = clamp(keyAt(gb - 1), 0, NKEYS - 1);
    const sc = scaleOf();

    g.save();
    g.beginPath();
    g.rect(gx, gy, W - gx, gb - gy);
    g.clip();
    for (let k = kBot; k <= kTop; k++) {
      const y = yAt(k);
      g.fillStyle = isBlack(k) ? C.black : C.white;
      g.fillRect(gx, y, W - gx, view.rowH);
      if (sc.type !== 'none') {
        if (!inScale(k, sc.root, sc.type)) {
          g.fillStyle = 'rgba(0,0,0,0.28)';
          g.fillRect(gx, y, W - gx, view.rowH);
        } else if ((((k - sc.root) % 12) + 12) % 12 === 0) {
          g.fillStyle = 'rgba(255,255,255,0.06)';
          g.fillRect(gx, y, W - gx, view.rowH);
        }
      }
      g.fillStyle = k % 12 === 0 ? C.octLine : C.rowLine;
      g.fillRect(gx, y + view.rowH - 1, W - gx, 1);
    }
    const t0 = Math.max(0, tickAt(gx));
    const t1 = tickAt(W);
    for (let b = Math.floor(t0 / BAR); b * BAR < t1; b++) {
      if (b % 2 === 1) {
        g.fillStyle = C.barShade;
        g.fillRect(xAt(b * BAR), gy, BAR * view.px, gb - gy);
      }
    }
    const stepPx = STEP * view.px;
    const beatPx = BEAT * view.px;
    const inc = stepPx >= 6 ? STEP : beatPx >= 6 ? BEAT : BAR;
    for (let t = Math.floor(t0 / inc) * inc; t <= t1; t += inc) {
      const x = Math.round(xAt(t));
      g.fillStyle = t % BAR === 0 ? C.bar : t % BEAT === 0 ? C.beat : C.step;
      g.fillRect(x, gy, t % BAR === 0 ? 2 : 1, gb - gy);
    }
    const ax = xAt(plen);
    if (ax < W) {
      g.fillStyle = C.after;
      g.fillRect(Math.max(gx, ax), gy, W - Math.max(gx, ax), gb - gy);
    }
    // Ghost notes from the other channels
    const cid = channel() ? channel().id : null;
    g.fillStyle = C.ghost;
    for (const [id, arr] of Object.entries(pat0.notes)) {
      if (id === cid) continue;
      for (const n of arr) {
        const x = xAt(n.t);
        const w = n.len * view.px;
        if (x > W || x + w < gx || n.key < kBot || n.key > kTop) continue;
        g.fillRect(x, yAt(n.key) + 1, Math.max(2, w - 1), view.rowH - 2);
      }
    }
    // Notes
    g.font = '10px system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (const n of notes()) {
      const x = xAt(n.t);
      const w = Math.max(3, n.len * view.px - 1);
      if (x > W || x + w < gx || n.key < kBot || n.key > kTop) continue;
      const y = yAt(n.key);
      g.fillStyle = n.s ? C.selEdge : C.noteEdge;
      g.fillRect(x, y, w, view.rowH - 1);
      g.fillStyle = n.s ? C.sel : C.note;
      g.globalAlpha = 0.55 + n.vel * 0.45;
      g.fillRect(x + 1, y + 1, w - 2, view.rowH - 3);
      g.globalAlpha = 1;
      if (n.slide) {
        // Slide note: a triangle on the left, like FL Studio.
        g.fillStyle = n.s ? C.selText : C.noteText;
        g.beginPath();
        g.moveTo(x + 2, y + view.rowH - 3);
        g.lineTo(x + 2 + Math.min(10, w - 4), y + view.rowH / 2);
        g.lineTo(x + 2, y + 2);
        g.closePath();
        g.fill();
      }
      if (w > 24 && view.rowH >= 12) {
        g.fillStyle = n.s ? C.selText : C.noteText;
        g.fillText(noteName(n.key), x + (n.slide ? 14 : 4), y + view.rowH / 2);
      }
    }
    if (overlay && overlay.type === 'box') {
      const { x0, y0, x1, y1 } = overlay;
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      g.strokeStyle = '#e6eaec';
      g.lineWidth = 1;
      g.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
    if (overlay && overlay.type === 'drop') {
      g.fillStyle = 'rgba(240,153,58,0.2)';
      g.fillRect(gx, yAt(overlay.key), W - gx, view.rowH);
      g.strokeStyle = '#f0993a';
      g.lineWidth = 2;
      g.strokeRect(xAt(overlay.t) + 1, yAt(overlay.key) + 1, Math.max(6, ui.lastLen * view.px) - 2, view.rowH - 2);
    }
    if (overlay && overlay.type === 'slice') {
      g.strokeStyle = '#f0993a';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(overlay.x, overlay.y0);
      g.lineTo(overlay.x, overlay.y1);
      g.stroke();
    }
    g.restore();

    // Ruler
    g.fillStyle = C.ruler;
    g.fillRect(0, 0, W, RULER_H);
    g.save();
    g.beginPath();
    g.rect(gx, 0, W - gx, RULER_H);
    g.clip();
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'middle';
    const barPx = BAR * view.px;
    const every = barPx < 28 ? Math.ceil(28 / barPx) : 1;
    for (let b = Math.floor(t0 / BAR); b * BAR < t1; b++) {
      const x = Math.round(xAt(b * BAR));
      g.fillStyle = '#5d6a70';
      g.fillRect(x, 10, 1, RULER_H - 10);
      if (b % every === 0) {
        g.fillStyle = C.rulerText;
        g.fillText(String(b + 1), x + 4, 9);
      }
      if (beatPx >= 10) {
        for (let q = 1; q < 4; q++) {
          g.fillStyle = '#4a565c';
          g.fillRect(Math.round(xAt(b * BAR + q * BEAT)), 16, 1, RULER_H - 16);
        }
      }
    }
    if (ax < W) {
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(Math.max(gx, ax), 0, W, RULER_H);
    }
    g.restore();
    g.fillStyle = '#151a1d';
    g.fillRect(0, RULER_H - 1, W, 1);

    // Keyboard
    g.save();
    g.beginPath();
    g.rect(0, gy, KEYS_W, gb - gy);
    g.clip();
    for (let k = kBot; k <= kTop; k++) {
      const y = yAt(k);
      g.fillStyle = C.keyWhite;
      g.fillRect(0, y, KEYS_W, view.rowH);
      if (isBlack(k)) {
        g.fillStyle = C.keyBlack;
        g.fillRect(0, y, KEYS_W * 0.62, view.rowH);
      }
      if (k === pressedKey) {
        g.fillStyle = C.play;
        g.fillRect(isBlack(k) ? 0 : KEYS_W * 0.62, y, isBlack(k) ? KEYS_W * 0.62 : KEYS_W * 0.38, view.rowH);
      }
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, y + view.rowH - 1, KEYS_W, 1);
      if (k % 12 === 0 && view.rowH >= 9) {
        g.fillStyle = C.keyText;
        g.font = '10px system-ui, sans-serif';
        g.textAlign = 'right';
        g.fillText(noteName(k), KEYS_W - 4, y + view.rowH / 2);
        g.textAlign = 'left';
      }
    }
    g.restore();
    g.fillStyle = '#151a1d';
    g.fillRect(KEYS_W - 1, gy, 1, gb - gy);

    // Corner
    g.fillStyle = C.ruler;
    g.fillRect(0, 0, KEYS_W, RULER_H);

    // Velocity lane
    if (showVel) {
      const y0 = gb;
      g.fillStyle = C.velBg;
      g.fillRect(0, y0, W, VEL_H);
      g.fillStyle = '#151a1d';
      g.fillRect(0, y0, W, 2);
      g.fillStyle = C.rulerText;
      g.font = '10px system-ui, sans-serif';
      g.fillText(t('Velocity'), 6, y0 + 14);
      g.save();
      g.beginPath();
      g.rect(gx, y0 + 2, W - gx, VEL_H - 2);
      g.clip();
      const base = y0 + VEL_H - 4;
      const span = VEL_H - 12;
      for (const n of notes()) {
        const x = Math.round(xAt(n.t));
        if (x < gx - 8 || x > W) continue;
        const hgt = Math.round(span * n.vel);
        g.fillStyle = n.s ? C.sel : C.note;
        g.fillRect(x, base - hgt, 2, hgt);
        g.fillRect(x - 2, base - hgt, 7, 3);
      }
      g.restore();
    }

    // Scrollbars
    const sbc = { track: th.colors.input, thumb: th.colors.dim };
    drawScrollbar(g, true, KEYS_W, H - SB, W - KEYS_W, SB, hView(), hTotal(), view.sx, sbc);
    drawScrollbar(g, false, W, RULER_H, gridY1() - RULER_H, SB, vView(), vTotal(), view.sy, sbc);
    g.fillStyle = th.colors.panel2;
    g.fillRect(0, H - SB, KEYS_W, SB);
    g.fillRect(W, 0, CW - W, RULER_H);
    g.fillRect(W, gridY1(), CW - W, H - gridY1());
  }

  // Editing helpers
  function addNote(t, key) {
    const n = { t: Math.max(0, t), len: ui.lastLen, key: clamp(key, 0, NKEYS - 1), vel: ui.lastVel };
    editNotes().push(n);
    return n;
  }

  function removeNote(n) {
    const arr = editNotes();
    const i = arr.indexOf(n);
    if (i >= 0) arr.splice(i, 1);
  }

  function eraseAt(p) {
    if (regionAt(p) !== 'grid') return;
    const hit = noteAt(p);
    if (hit) {
      removeNote(hit.n);
      store.emit();
    }
  }

  function eraseLine(a, b) {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(d / 4));
    for (let i = 1; i <= steps; i++) eraseAt({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
  }

  function beginMove(st, hit) {
    const group = hit.n.s ? selected() : [hit.n];
    if (!hit.n.s) clearSel();
    st.mode = hit.edge ? 'resize' : 'move';
    st.primary = { n: hit.n, t0: hit.n.t, key0: hit.n.key, len0: hit.n.len };
    st.group = group.map((n) => ({ n, t0: n.t, key0: n.key, len0: n.len }));
    st.lastKey = hit.n.key;
  }

  function doMove(p, st) {
    const dtRaw = tickAt(p.x) - tickAt(st.p0.x);
    const pr = st.primary;
    if (st.mode === 'move') {
      let dT = snapRound(pr.t0 + dtRaw) - pr.t0;
      const minT = Math.min(...st.group.map((o) => o.t0));
      if (minT + dT < 0) dT = -minT;
      let dk = keyAt(p.y) - keyAt(st.p0.y);
      const kMin = Math.min(...st.group.map((o) => o.key0));
      const kMax = Math.max(...st.group.map((o) => o.key0));
      dk = clamp(dk, -kMin, NKEYS - 1 - kMax);
      for (const o of st.group) {
        o.n.t = o.t0 + dT;
        o.n.key = o.key0 + dk;
      }
      if (pr.n.key !== st.lastKey) {
        st.lastKey = pr.n.key;
        preview(pr.n.key, pr.n.vel);
      }
      hint(noteName(pr.n.key) + t('  position ') + fmtPos(pr.n.t));
    } else {
      const end0 = pr.t0 + pr.len0;
      const dLen = snapRound(end0 + dtRaw) - end0;
      for (const o of st.group) o.n.len = Math.max(minLen(), o.len0 + dLen);
      ui.lastLen = pr.n.len;
      hint(t('Length ') + fmtLen(pr.n.len));
    }
    store.emit();
  }

  function sliceAt(x, kA, kB) {
    const T = snapRound(tickAt(x));
    const lo = Math.min(kA, kB);
    const hi = Math.max(kA, kB);
    const arr = editNotes();
    const add = [];
    for (const n of arr) {
      if (n.key >= lo && n.key <= hi && n.t < T && n.t + n.len > T) {
        add.push({ t: T, len: n.t + n.len - T, key: n.key, vel: n.vel });
        n.len = T - n.t;
      }
    }
    arr.push(...add);
    return add.length;
  }

  // Pointer handling
  attachPointer(cv, {
    down(p, st) {
      st.region = regionAt(p);
      if (st.region === 'hscroll' || st.region === 'vscroll') return scrollbarDown(p, st);
      if (!channel()) return;
      if (st.region === 'keys') {
        const k = keyAt(p.y);
        keyDown(k);
      } else if (st.region === 'vel') {
        store.commit();
        st.committed = true;
        setVel(p);
      } else if (st.region === 'ruler') {
        seek(p);
      } else if (st.region === 'grid' && (ui.prTool === 'delete' || st.button === 2)) {
        store.commit();
        st.committed = true;
        st.erasing = true;
        eraseAt(p);
      }
    },
    tap(p, st) {
      if (st.region === 'keys') return keyUp();
      if (st.region !== 'grid' || st.erasing || !channel()) return;
      const hit = noteAt(p);
      const tool = ui.prTool;
      if (tool === 'draw' || tool === 'paint') {
        if (hit) {
          ui.lastLen = hit.n.len;
          ui.lastVel = hit.n.vel;
          preview(hit.n.key, hit.n.vel);
          hint(noteName(hit.n.key) + t('  length ') + fmtLen(hit.n.len));
        } else {
          store.commit();
          clearSel();
          const n = addNote(snapFloor(tickAt(p.x)), keyAt(p.y));
          preview(n.key, n.vel);
          store.emit();
        }
      } else if (tool === 'select') {
        clearSel();
        if (hit) hit.n.s = true;
        store.emit();
      } else if (tool === 'slice') {
        store.commit();
        const k = keyAt(p.y);
        if (!sliceAt(p.x, k, k)) store.undoStack.pop();
        store.emit();
      }
    },
    dragStart(p0, p, st) {
      if (st.region !== 'grid') return;
      if (!channel()) return;
      if (st.erasing) return;
      const tool = ui.prTool;
      if (tool === 'hand') {
        st.mode = 'pan';
        return;
      }
      if (tool === 'slice') {
        st.mode = 'slice';
        return;
      }
      const hit = noteAt(p0);
      if (tool === 'select' && !hit) {
        st.mode = 'box';
        return;
      }
      store.commit();
      st.committed = true;
      if (hit) {
        if (tool === 'select' && !hit.n.s) {
          clearSel();
          hit.n.s = true;
        }
        beginMove(st, hit);
        return;
      }
      clearSel();
      const n = addNote(snapFloor(tickAt(p0.x)), keyAt(p0.y));
      preview(n.key, n.vel);
      if (tool === 'paint') {
        st.mode = 'paint';
        st.nextT = n.t + n.len;
      } else {
        beginMove(st, { n, edge: false });
      }
      store.emit();
    },
    dragMove(p, st) {
      if (st.region === 'hscroll' || st.region === 'vscroll') return scrollbarMove(p, st);
      if (st.region === 'keys') {
        const k = keyAt(p.y);
        if (k !== pressedKey) keyDown(k);
        return;
      }
      if (st.region === 'vel') return setVel(p);
      if (st.region === 'ruler') return seek(p);
      if (st.erasing) return eraseLine(st.last, p);
      if (st.mode === 'pan') {
        view.sx -= p.x - st.last.x;
        view.sy -= p.y - st.last.y;
        clampView();
        draw();
      } else if (st.mode === 'move' || st.mode === 'resize') {
        doMove(p, st);
      } else if (st.mode === 'paint') {
        const k = clamp(keyAt(p.y), 0, NKEYS - 1);
        while (snapFloor(tickAt(p.x)) >= st.nextT) {
          const n = addNote(st.nextT, k);
          st.nextT = n.t + n.len;
        }
        store.emit();
      } else if (st.mode === 'box') {
        overlay = { type: 'box', x0: st.p0.x, y0: st.p0.y, x1: p.x, y1: p.y };
        const ta = tickAt(Math.min(st.p0.x, p.x));
        const tb = tickAt(Math.max(st.p0.x, p.x));
        const ka = keyAt(Math.max(st.p0.y, p.y));
        const kb = keyAt(Math.min(st.p0.y, p.y));
        for (const n of notes()) {
          if (n.key >= ka && n.key <= kb && n.t < tb && n.t + n.len > ta) n.s = true;
          else delete n.s;
        }
        draw();
      } else if (st.mode === 'slice') {
        overlay = { type: 'slice', x: Math.round(xAt(snapRound(tickAt(st.p0.x)))), y0: Math.min(st.p0.y, p.y), y1: Math.max(st.p0.y, p.y) };
        draw();
      }
    },
    dragEnd(p, st) {
      if (st.region === 'keys') return keyUp();
      if (st.mode === 'slice') {
        overlay = null;
        store.commit();
        if (!sliceAt(st.p0.x, keyAt(st.p0.y), keyAt(p.y))) store.undoStack.pop();
        store.emit();
      } else if (st.mode === 'box') {
        overlay = null;
        const count = selected().length;
        hint(count + (count > 1 ? t(' notes selected') : t(' note selected')));
        draw();
      }
    },
    longPress(p, st) {
      if (st.region !== 'grid' || !channel()) return;
      if (ui.prTool === 'hand' || ui.prTool === 'delete' || ui.prTool === 'slice') return;
      const hit = noteAt(p);
      if (hit) {
        store.commit();
        removeNote(hit.n);
        hint(t('Note deleted'));
        store.emit();
      }
    },
    cancel(st) {
      if (st.region === 'keys') keyUp();
      overlay = null;
      if (st.committed) store.revert();
      else draw();
    },
    gesture(gst) {
      if (gst.axis === 'x') zoomX(gst.sx, gst.cx, true);
      else zoomY(gst.sy, gst.cy, true);
      view.sx -= gst.dcx;
      view.sy -= gst.dcy;
      clampView();
      draw();
    },
    wheel(e, p) {
      if (e.ctrlKey) zoomX(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x);
      else if (e.altKey) zoomY(e.deltaY < 0 ? 1.1 : 1 / 1.1, p.y);
      else if (e.shiftKey) view.sx += e.deltaY;
      else {
        view.sy += e.deltaY;
        view.sx += e.deltaX;
      }
      clampView();
      draw();
    },
  });

  // Drop from the browser: the channel is created (or reused for a sample)
  // and a note is placed where the finger is released.
  const dropSpot = (p) => (regionAt(p) === 'grid' ? { type: 'drop', key: clamp(keyAt(p.y), 0, NKEYS - 1), t: Math.max(0, snapFloor(tickAt(p.x))) } : null);
  registerDrop({
    el: cv,
    accepts: (item) => item.kind === 'sample' || item.kind === 'instrument',
    over(item, p) {
      overlay = dropSpot(p);
      draw();
    },
    leave() {
      overlay = null;
      draw();
    },
    drop(item, p) {
      const spot = dropSpot(p);
      overlay = null;
      store.commit();
      const proj = store.project;
      const c = item.kind === 'sample' ? samplerChannel(proj, item.id) : createChannel(proj, item.id);
      if (!c) {
        store.undoStack.pop();
        return draw();
      }
      ui.prChannel = c.id;
      clearSel();
      if (spot) {
        const n = { t: spot.t, len: ui.lastLen, key: spot.key, vel: ui.lastVel };
        notesFor(currentPattern(proj), c.id).push(n);
      }
      store.emit();
      if (spot) engine.preview(c, spot.key, ui.lastVel, 0.4);
      hint(c.name + (spot ? t(': note ') + noteName(spot.key) + t(' added') : t(' added to the rack')));
    },
  });

  function zoomX(f, cx, noDraw) {
    const t = tickAt(cx);
    view.px = clamp(view.px * f, 0.08, 10);
    view.sx = t * view.px - (cx - KEYS_W);
    clampView();
    if (!noDraw) draw();
  }

  function zoomY(f, cy, noDraw) {
    const rowF = (cy - RULER_H + view.sy) / view.rowH;
    view.rowH = clamp(view.rowH * f, 8, 44);
    view.sy = rowF * view.rowH - (cy - RULER_H);
    clampView();
    if (!noDraw) draw();
  }

  // Live recording: while Record is on and the pattern plays, notes played
  // on the keyboard are written at the play position (snapped to the grid).
  let rec = null;
  const recording = () => ui.recording && engine.playing && !ui.songMode && !engine.countingIn() && channel();

  function keyDown(k) {
    if (k < 0 || k >= NKEYS) return;
    keyUp();
    pressedKey = k;
    const c = channel();
    if (c) held = engine.noteOn(c, k, ui.lastVel);
    if (recording()) rec = { key: k, start: engine.heardPosition(), channelId: c.id };
    hint(noteName(k));
    draw();
  }

  function keyUp() {
    if (held) engine.noteOff(held);
    held = null;
    if (rec) {
      const r = rec;
      rec = null;
      const pat0 = pat();
      const L = patternLength(pat0);
      let len = engine.heardPosition() - r.start;
      if (len < 0) len += L;
      const t = ((snapRound(r.start) % L) + L) % L;
      store.commit();
      notesFor(pat0, r.channelId).push({ t, len: Math.max(minLen(), snapRound(len) || snap()), key: r.key, vel: ui.lastVel });
      store.emit();
    }
    pressedKey = -1;
    draw();
  }

  function setVel(p) {
    const y0 = gridY1();
    const v = clamp((y0 + VEL_H - 4 - p.y) / (VEL_H - 12), 0, 1);
    const sel = selected();
    const pool = sel.length ? sel : notes();
    let best = null;
    let bestD = 10;
    for (const n of pool) {
      const d = Math.abs(xAt(n.t) - p.x);
      if (d < bestD) {
        best = n;
        bestD = d;
      }
    }
    if (best) {
      for (const n of pool) if (Math.abs(xAt(n.t) - xAt(best.t)) < 1) n.vel = v;
      ui.lastVel = v;
      hint(t('Velocity ') + Math.round(v * 100) + '%');
      store.emit();
    }
  }

  function seek(p) {
    if (ui.songMode) return;
    engine.setPosition(Math.max(0, snapFloor(tickAt(p.x))));
    draw();
  }

  // Edit actions
  function copySel() {
    const sel = selected();
    const src = sel.length ? sel : notes();
    if (!src.length) return;
    ui.clipboard = src.map((n) => ({ t: n.t, len: n.len, key: n.key, vel: n.vel }));
    hint(src.length + (src.length > 1 ? t(' notes copied') : t(' note copied')));
  }

  function paste() {
    if (!ui.clipboard || !channel()) return;
    store.commit();
    clearSel();
    const arr = editNotes();
    for (const n of ui.clipboard) arr.push({ ...n, s: true });
    hint(t('Notes pasted, drag them into place'));
    store.emit();
  }

  function duplicate() {
    if (!channel()) return;
    const sel = selected();
    const src = sel.length ? sel : notes();
    if (!src.length) return;
    store.commit();
    const minT = Math.min(...src.map((n) => n.t));
    const maxE = Math.max(...src.map((n) => n.t + n.len));
    const unit = Math.max(snap(), STEP);
    const span = Math.ceil((maxE - minT) / unit) * unit;
    clearSel();
    const arr = editNotes();
    for (const n of src) arr.push({ t: n.t + span, len: n.len, key: n.key, vel: n.vel, s: true });
    store.emit();
  }

  function deleteSel() {
    if (!channel()) return;
    const sel = selected();
    if (!sel.length) return;
    store.commit();
    const arr = editNotes();
    pat().notes[channel().id] = arr.filter((n) => !n.s);
    store.emit();
  }

  function transpose(d) {
    if (!channel()) return;
    const sel = selected();
    const src = sel.length ? sel : notes();
    if (!src.length) return;
    if (src.some((n) => n.key + d < 0 || n.key + d >= NKEYS)) return;
    store.commit();
    for (const n of src) n.key += d;
    store.emit();
  }

  function quantize() {
    const sel = selected();
    const src = sel.length ? sel : notes();
    if (!src.length) return;
    store.commit();
    for (const n of src) n.t = Math.max(0, snapRound(n.t));
    store.emit();
  }

  function selectAll() {
    for (const n of notes()) n.s = true;
    store.emit();
  }

  function clearAll() {
    if (!channel() || !notes().length) return;
    store.commit();
    pat().notes[channel().id] = [];
    store.emit();
  }

  // Apply a note tool to the selection (or every note of the channel).
  // fn(src) changes notes in place, or returns { add } or { replace } arrays.
  function applyTool(label, fn) {
    if (!channel()) return;
    const sel = selected();
    const src = sel.length ? sel : notes().slice();
    if (!src.length) {
      hint(t('No notes to change'));
      return;
    }
    store.commit();
    const res = fn(src) || {};
    const arr = editNotes();
    if (res.replace) {
      const gone = new Set(src);
      pat().notes[channel().id] = arr.filter((n) => !gone.has(n)).concat(res.replace.map((n) => ({ ...n, s: !!sel.length })));
    } else if (res.add) {
      for (const n of res.add) arr.push({ ...n, s: !!sel.length });
    }
    for (const n of pat().notes[channel().id]) {
      n.t = Math.max(0, Math.round(n.t));
      n.len = Math.max(1, Math.round(n.len));
      n.key = clamp(n.key, 0, NKEYS - 1);
    }
    hint(label);
    store.emit();
  }

  function toolsMenu(anchor) {
    const sc = scaleOf();
    openMenu(anchor, [
      { header: t('Tools apply to the selection, or to every note') },
      { label: t('Chord') + '...', icon: 'ListMusic', onClick: () => chordMenu(anchor) },
      { label: t('Arpeggiate') + '...', icon: 'AudioLines', onClick: () => arpMenu(anchor) },
      { label: t('Strum'), icon: 'Guitar', onClick: () => applyTool(t('Strum'), (src) => { strum(src, Math.max(4, Math.round(snap() / 4)), true); }) },
      { label: t('Humanize'), icon: 'Shuffle', onClick: () => applyTool(t('Humanize'), (src) => { humanize(src, { vel: 0.12, time: 2 }); }) },
      { label: t('Legato'), icon: 'ChevronRight', onClick: () => applyTool(t('Legato'), (src) => { legato(src); }) },
      { label: t('Slide notes on or off'), icon: 'Activity', onClick: () => applyTool(t('Slide notes'), (src) => {
        const on = !src.every((n) => n.slide);
        for (const n of src) {
          if (on) n.slide = true;
          else delete n.slide;
        }
      }) },
      { sep: true },
      { label: t('Reverse'), icon: 'RefreshCw', onClick: () => applyTool(t('Reverse'), (src) => { reverseNotes(src); }) },
      { label: t('Flip'), icon: 'ArrowUp', onClick: () => applyTool(t('Flip'), (src) => { flipNotes(src); }) },
      { label: t('Double length'), icon: 'ZoomIn', onClick: () => applyTool(t('Double length'), (src) => { stretchNotes(src, 2); }) },
      { label: t('Half length'), icon: 'ZoomOut', onClick: () => applyTool(t('Half length'), (src) => { stretchNotes(src, 0.5); }) },
      { sep: true },
      { label: t('Snap notes to scale'), icon: 'Magnet', disabled: sc.type === 'none', onClick: () => applyTool(t('Snap notes to scale'), (src) => { snapToScale(src, sc.root, sc.type); }) },
    ]);
  }

  function chordMenu(anchor) {
    openMenu(anchor, [
      { header: t('Each note becomes the root of a chord') },
      ...CHORDS.map((c) => ({ label: t(c.name), onClick: () => applyTool(t('Chord') + ': ' + t(c.name), (src) => ({ add: chordify(src, c.id) })) })),
    ]);
  }

  function arpMenu(anchor) {
    const rate = Math.max(snap(), 6);
    const go = (pattern, label) => applyTool(t('Arpeggiate') + ': ' + label, (src) => ({ replace: arpeggiate(src, rate, pattern) }));
    openMenu(anchor, [
      { header: t('Notes of each chord are played one by one, at the snap length') },
      { label: t('Up'), icon: 'ArrowUp', onClick: () => go('up', t('Up')) },
      { label: t('Down'), icon: 'ArrowDown', onClick: () => go('down', t('Down')) },
      { label: t('Up and down'), icon: 'ChevronsUp', onClick: () => go('updown', t('Up and down')) },
    ]);
  }

  function scaleMenu(anchor) {
    const sc = scaleOf();
    const setScale = (root, type) => {
      store.change((p) => { p.scale = { root, type }; });
      refreshTools();
    };
    openMenu(anchor, [
      { label: t('No scale'), checked: sc.type === 'none', onClick: () => setScale(sc.root, 'none') },
      { label: t('Detect from the notes'), icon: 'Search', onClick: () => {
        const all = [];
        const p = store.project;
        for (const pt of p.patterns) for (const [cid, arr] of Object.entries(pt.notes)) {
          const c = p.channels.find((x) => x.id === cid);
          if (c && !['kick', 'snare', 'clap', 'hat', 'ohat', 'crash', 'tom', 'rim', 'cowbell'].includes(c.instrument)) all.push(...arr);
        }
        const k = detectKey(all);
        if (!k) return hint(t('No melodic notes to analyse'));
        setScale(k.root, k.type);
        hint(t('Detected key: ') + NOTE_NAMES[k.root] + ' ' + t(k.type === 'major' ? 'Major' : 'Minor'));
      } },
      { label: t('Root note') + ': ' + NOTE_NAMES[sc.root] + '...', icon: 'Piano', onClick: () => openMenu(anchor, NOTE_NAMES.map((nm, i) => ({ label: nm, checked: i === sc.root, onClick: () => setScale(i, sc.type === 'none' ? 'major' : sc.type) }))) },
      { sep: true },
      ...SCALES.map((x) => ({ label: t(x.name), checked: sc.type === x.id, onClick: () => setScale(sc.root, x.id) })),
    ]);
  }

  function moreMenu(anchor) {
    openMenu(anchor, [
      { label: t('Select all'), onClick: selectAll },
      { label: t('Deselect'), onClick: () => { clearSel(); store.emit(); } },
      { sep: true },
      { label: t('Quantize note starts'), onClick: quantize },
      { label: t('Up one octave'), icon: 'ChevronsUp', onClick: () => transpose(12) },
      { label: t('Down one octave'), icon: 'ChevronsDown', onClick: () => transpose(-12) },
      { sep: true },
      { label: t('Clear channel notes'), icon: 'Trash', onClick: clearAll },
    ]);
  }

  function fmtPos(tk) {
    return Math.floor(tk / BAR) + 1 + ':' + String(Math.floor((tk % BAR) / STEP) + 1).padStart(2, '0') + ':' + String(Math.round(tk % STEP)).padStart(2, '0');
  }

  function fmtLen(tk) {
    if (tk % BAR === 0) return tk / BAR + (tk / BAR > 1 ? t(' bars') : t(' bar'));
    if (tk % BEAT === 0) return tk / BEAT + (tk / BEAT > 1 ? t(' beats') : t(' beats'));
    if (tk % STEP === 0) return tk / STEP + (tk / STEP > 1 ? t(' steps') : t(' steps'));
    return tk + ' ticks';
  }

  let headShown = false;
  fitCanvas(headCv, (w, hh, r) => {
    hdpr = r;
    hg = headCv.getContext('2d');
    drawHead();
  });
  fitCanvas(cv, (w, hh, r) => {
    CW = w;
    W = w - SB;
    H = hh;
    dpr = r;
    g = cv.getContext('2d');
    if (!view.ready && H > 50) {
      view.ready = true;
      view.sy = (NKEYS - 1 - 66) * view.rowH - (gridY1() - gridY0()) / 2;
    }
    clampView();
    draw();
  });

  function keydown(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Delete' || e.key === 'Backspace') deleteSel();
    else if (mod && e.key.toLowerCase() === 'a') selectAll();
    else if (mod && e.key.toLowerCase() === 'c') copySel();
    else if (mod && e.key.toLowerCase() === 'v') paste();
    else if (mod && e.key.toLowerCase() === 'b') duplicate();
    else if (mod && e.key.toLowerCase() === 'q') quantize();
    else if (e.key === 'ArrowUp' && e.shiftKey) transpose(12);
    else if (e.key === 'ArrowDown' && e.shiftKey) transpose(-12);
    else if (e.key === 'ArrowUp') transpose(1);
    else if (e.key === 'ArrowDown') transpose(-1);
    else if (e.key.toLowerCase() === 'p') { ui.prTool = 'draw'; refreshTools(); }
    else if (e.key.toLowerCase() === 'b') { ui.prTool = 'paint'; refreshTools(); }
    else if (e.key.toLowerCase() === 'd') { ui.prTool = 'delete'; refreshTools(); }
    else if (e.key.toLowerCase() === 'e') { ui.prTool = 'select'; refreshTools(); }
    else if (e.key.toLowerCase() === 'c') { ui.prTool = 'slice'; refreshTools(); }
    else return false;
    e.preventDefault();
    return true;
  }

  refreshTools();
  return {
    el,
    update() {
      refreshChannels();
      refreshTools();
      draw();
    },
    frame() {
      if (engine.playing && !ui.songMode) drawHead();
      else if (headShown) drawHead();
      headShown = engine.playing && !ui.songMode;
    },
    keydown,
    focusKey(k) {
      view.sy = (NKEYS - 1 - k) * view.rowH - (gridY1() - gridY0()) / 2;
      clampView();
    },
  };
}
