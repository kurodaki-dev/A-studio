import { h, btn, icon, hint, openMenu } from './dom.js';
import { attachPointer, fitCanvas } from './pointer.js';
import { store, currentPattern, notesOf, notesFor, patternLength, getChannel } from '../store.js';
import { ui } from '../ui-state.js';
import { BAR, BEAT, STEP, NKEYS, SNAPS, snapTicks, noteName, isBlack, clamp } from '../constants.js';

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
  const wrap = h('div', { class: 'cvwrap' }, cv);
  const view = { px: 1, rowH: 18, sx: 0, sy: (NKEYS - 1 - 79) * 18 };
  let W = 0;
  let H = 0;
  let dpr = 1;
  let g = null;
  let showVel = window.innerHeight > 520;
  let pressedKey = -1;
  let held = null;
  let overlay = null; // box or slice preview

  // Toolbar
  const chanSel = h('select', { class: 'sel', 'aria-label': 'Canal', onChange: (e) => { ui.prChannel = e.target.value; clearSel(); store.emit(); } });
  const toolDefs = [
    ['draw', 'Pencil', 'Dessiner'],
    ['paint', 'Paintbrush', 'Pinceau'],
    ['delete', 'Eraser', 'Supprimer'],
    ['select', 'SquareDashed', 'Sélection'],
    ['slice', 'Scissors', 'Couper'],
    ['hand', 'Hand', 'Déplacer la vue'],
  ];
  const toolBtns = toolDefs.map(([id, ic, label]) => {
    const b = btn(ic, label, () => {
      ui.prTool = id;
      hint('Outil : ' + label);
      refreshTools();
    });
    b.dataset.tool = id;
    return b;
  });
  const snapBtn = h('button', { class: 'b tb snap', type: 'button', title: 'Magnétisme', onClick: (e) => {
    openMenu(e.currentTarget, SNAPS.map((s) => ({ label: s.label, checked: ui.prSnap === s.id, onClick: () => { ui.prSnap = s.id; refreshTools(); } })));
  } }, icon('Magnet', 16), h('span', { class: 'snap-label' }));
  const velBtn = btn('AudioLines', 'Afficher les vélocités', () => { showVel = !showVel; refreshTools(); draw(); });

  const bar = h('div', { class: 'ptools' },
    h('div', { class: 'grp' }, chanSel),
    h('div', { class: 'grp' }, toolBtns),
    h('div', { class: 'grp' }, snapBtn),
    h('div', { class: 'grp' },
      btn('Copy', 'Copier', () => copySel()),
      btn('ClipboardPaste', 'Coller', () => paste()),
      btn('CopyPlus', 'Dupliquer', () => duplicate()),
      btn('Trash', 'Supprimer la sélection', () => deleteSel()),
      btn('ArrowUp', 'Monter d’un demi ton', () => transpose(1)),
      btn('ArrowDown', 'Descendre d’un demi ton', () => transpose(-1)),
      btn('Menu', 'Plus d’actions', (e) => moreMenu(e.currentTarget)),
    ),
    h('div', { class: 'grp' },
      btn('ZoomOut', 'Zoom arrière', () => zoomX(1 / 1.4, gridX0() + (W - KEYS_W) / 2)),
      btn('ZoomIn', 'Zoom avant', () => zoomX(1.4, gridX0() + (W - KEYS_W) / 2)),
      velBtn,
    ),
  );
  const el = h('div', { class: 'panel pr' }, bar, wrap);

  function refreshTools() {
    toolBtns.forEach((b) => b.classList.toggle('on', b.dataset.tool === ui.prTool));
    snapBtn.querySelector('.snap-label').textContent = (SNAPS.find((s) => s.id === ui.prSnap) || SNAPS[5]).label;
    velBtn.classList.toggle('on', showVel);
  }

  function refreshChannels() {
    const p = store.project;
    if (!getChannel(p, ui.prChannel)) ui.prChannel = p.channels[0] ? p.channels[0].id : null;
    const sig = p.channels.map((c) => c.id + c.name).join('|');
    if (chanSel.dataset.sig !== sig) {
      chanSel.replaceChildren(...p.channels.map((c) => h('option', { value: c.id }, c.name)));
      chanSel.dataset.sig = sig;
    }
    if (ui.prChannel) chanSel.value = ui.prChannel;
  }

  // Geometry
  const gridX0 = () => KEYS_W;
  const gridY0 = () => RULER_H;
  const gridY1 = () => H - (showVel ? VEL_H : 0);
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

  function regionAt(p) {
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

  // Drawing
  function draw() {
    if (!g) return;
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

    g.save();
    g.beginPath();
    g.rect(gx, gy, W - gx, gb - gy);
    g.clip();
    for (let k = kBot; k <= kTop; k++) {
      const y = yAt(k);
      g.fillStyle = isBlack(k) ? C.black : C.white;
      g.fillRect(gx, y, W - gx, view.rowH);
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
      if (w > 24 && view.rowH >= 12) {
        g.fillStyle = n.s ? C.selText : C.noteText;
        g.fillText(noteName(n.key), x + 4, y + view.rowH / 2);
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
    if (overlay && overlay.type === 'slice') {
      g.strokeStyle = '#f0993a';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(overlay.x, overlay.y0);
      g.lineTo(overlay.x, overlay.y1);
      g.stroke();
    }
    const showHead = !ui.songMode && (engine.playing || engine.pos > 0);
    if (showHead) {
      const x = Math.round(xAt(engine.position()));
      g.fillStyle = C.play;
      g.fillRect(x, gy, 1, gb - gy);
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
    if (showHead) {
      const x = Math.round(xAt(engine.position()));
      g.fillStyle = C.play;
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
      g.fillText('Vélocité', 6, y0 + 14);
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
      hint(noteName(pr.n.key) + '  position ' + fmtPos(pr.n.t));
    } else {
      const end0 = pr.t0 + pr.len0;
      const dLen = snapRound(end0 + dtRaw) - end0;
      for (const o of st.group) o.n.len = Math.max(minLen(), o.len0 + dLen);
      ui.lastLen = pr.n.len;
      hint('Longueur ' + fmtLen(pr.n.len));
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
          hint(noteName(hit.n.key) + '  longueur ' + fmtLen(hit.n.len));
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
      if (st.region === 'keys' || st.region === 'vel' || st.region === 'ruler' || st.region === 'corner') return;
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
        hint(count + (count > 1 ? ' notes sélectionnées' : ' note sélectionnée'));
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
        hint('Note supprimée');
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

  function keyDown(k) {
    if (k < 0 || k >= NKEYS) return;
    keyUp();
    pressedKey = k;
    const c = channel();
    if (c) held = engine.noteOn(c, k, ui.lastVel);
    hint(noteName(k));
    draw();
  }

  function keyUp() {
    if (held) engine.noteOff(held);
    held = null;
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
      hint('Vélocité ' + Math.round(v * 100) + '%');
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
    hint(src.length + (src.length > 1 ? ' notes copiées' : ' note copiée'));
  }

  function paste() {
    if (!ui.clipboard || !channel()) return;
    store.commit();
    clearSel();
    const arr = editNotes();
    for (const n of ui.clipboard) arr.push({ ...n, s: true });
    hint('Notes collées, faites les glisser pour les placer');
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

  function moreMenu(anchor) {
    openMenu(anchor, [
      { label: 'Tout sélectionner', onClick: selectAll },
      { label: 'Désélectionner', onClick: () => { clearSel(); store.emit(); } },
      { sep: true },
      { label: 'Quantifier les débuts', onClick: quantize },
      { label: 'Monter d’une octave', icon: 'ChevronsUp', onClick: () => transpose(12) },
      { label: 'Descendre d’une octave', icon: 'ChevronsDown', onClick: () => transpose(-12) },
      { sep: true },
      { label: 'Effacer les notes du canal', icon: 'Trash', onClick: clearAll },
    ]);
  }

  function fmtPos(t) {
    return Math.floor(t / BAR) + 1 + ':' + String(Math.floor((t % BAR) / STEP) + 1).padStart(2, '0') + ':' + String(Math.round(t % STEP)).padStart(2, '0');
  }

  function fmtLen(t) {
    if (t % BAR === 0) return t / BAR + (t / BAR > 1 ? ' mesures' : ' mesure');
    if (t % BEAT === 0) return t / BEAT + (t / BEAT > 1 ? ' temps' : ' temps');
    if (t % STEP === 0) return t / STEP + (t / STEP > 1 ? ' pas' : ' pas');
    return t + ' ticks';
  }

  fitCanvas(cv, (w, hh, r) => {
    W = w;
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
      draw();
    },
    frame() {
      if (engine.playing && !ui.songMode) draw();
    },
    keydown,
    focusKey(k) {
      view.sy = (NKEYS - 1 - k) * view.rowH - (gridY1() - gridY0()) / 2;
      clampView();
    },
  };
}
