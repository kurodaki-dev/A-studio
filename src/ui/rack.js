import { h, btn, icon, hint, openMenu, promptText, confirmBox } from './dom.js';
import { knob, led } from './controls.js';
import { store, currentPattern, notesOf, notesFor, patternLength, isStepChannel, makeChannel } from '../store.js';
import { ui } from '../ui-state.js';
import { STEP, BAR, clamp } from '../constants.js';
import { CATALOG, CATEGORIES, instrumentName } from '../audio/catalog.js';

export function addChannelMenu(anchor, engine, onAdded) {
  const items = [];
  CATEGORIES.forEach((cat, i) => {
    if (i) items.push({ sep: true });
    for (const inst of CATALOG.filter((x) => x.cat === cat.id)) {
      items.push({ label: inst.name, icon: cat.icon, onClick: () => addChannel(inst.id, engine, onAdded) });
    }
  });
  openMenu(anchor, items);
}

export function addChannel(instId, engine, onAdded) {
  if (store.project.channels.length >= 64) return;
  store.change((p) => {
    const used = new Set(p.channels.map((c) => c.insert));
    let insert = 0;
    for (let i = 1; i < p.mixer.length; i++) {
      if (!used.has(i)) {
        insert = i;
        break;
      }
    }
    const c = makeChannel(instId, instrumentName(instId), insert);
    p.channels.push(c);
    ui.prChannel = c.id;
  });
  hint(instrumentName(instId) + ' ajouté au rack');
  onAdded && onAdded();
}

export function createRack(engine, actions) {
  const list = h('div', { class: 'rack-list' });
  const stepsInfo = h('span', { class: 'rack-info' });
  const head = h('div', { class: 'ptools' },
    h('div', { class: 'grp' }, h('span', { class: 'ptitle' }, 'Channel rack'), stepsInfo),
    h('div', { class: 'grp' },
      btn('Minus', 'Retirer une mesure', () => changeBars(-1)),
      btn('Plus', 'Ajouter une mesure', () => changeBars(1)),
    ),
  );
  const addBtn = h('button', { class: 'b tb rack-add', type: 'button', onClick: (e) => addChannelMenu(e.currentTarget, engine) }, icon('Plus', 16), 'Ajouter un canal');
  const scroller = h('div', { class: 'rack-scroll' }, list, addBtn);
  const el = h('div', { class: 'panel rack' }, head, scroller);
  let rows = [];
  let sig = '';
  let lastStep = -1;

  function changeBars(d) {
    const pat = currentPattern(store.project);
    const L = patternLength(pat) / BAR;
    const next = clamp((d > 0 ? L : pat.minBars) + d, 1, 64);
    if (d < 0 && pat.minBars <= 1) return;
    store.change(() => {
      pat.minBars = next;
    });
  }

  function stepCount() {
    return patternLength(currentPattern(store.project)) / STEP;
  }

  function build() {
    const p = store.project;
    const pat = currentPattern(p);
    const n = stepCount();
    rows = p.channels.map((c, ci) => {
      const notes = notesOf(pat, c.id);
      const stepMode = isStepChannel(notes);
      const mute = led(!c.mute, 'Canal actif', () => store.change(() => { c.mute = !c.mute; }));
      const pan = knob({
        value: c.pan, min: -1, max: 1, def: 0, size: 22, label: 'Panoramique ' + c.name,
        format: (v) => (Math.abs(v) < 0.01 ? 'Centre' : Math.round(Math.abs(v) * 100) + '% ' + (v < 0 ? 'gauche' : 'droite')),
        onStart: () => store.commit(),
        onInput: (v) => { c.pan = v; store.emit(); },
      });
      const vol = knob({
        value: c.vol, min: 0, max: 1, def: 0.78, size: 22, label: 'Volume ' + c.name,
        onStart: () => store.commit(),
        onInput: (v) => { c.vol = v; store.emit(); },
      });
      const ins = h('button', { class: 'rack-ins', type: 'button', title: 'Insert du mixer', onClick: (e) => insertMenu(e.currentTarget, c) }, c.insert === 0 ? 'M' : String(c.insert));
      const name = h('button', { class: 'rack-name', type: 'button', title: instrumentName(c.instrument), onClick: (e) => channelMenu(e.currentTarget, c, ci) }, c.name);
      let body;
      let stepEls = [];
      if (stepMode) {
        body = h('div', { class: 'steps' });
        for (let i = 0; i < n; i++) {
          const s = h('div', { class: 'step g' + (Math.floor(i / 4) % 2), 'data-i': i });
          stepEls.push(s);
          body.append(s);
        }
        attachSteps(body, c);
      } else {
        body = h('canvas', { class: 'mini', title: 'Ouvrir dans le piano roll', onClick: () => actions.openPianoRoll(c.id) });
      }
      const row = h('div', { class: 'rack-row' + (ui.prChannel === c.id ? ' current' : '') }, mute, pan, vol, ins, name, body);
      return { c, row, mute, pan, vol, body, stepEls, stepMode };
    });
    list.replaceChildren(...rows.map((r) => r.row));
    patch();
  }

  function attachSteps(container, c) {
    let mode = null;
    const seen = new Set();
    const toggle = (target) => {
      const i = Number(target.dataset.i);
      if (Number.isNaN(i) || seen.has(i)) return;
      seen.add(i);
      const pat = currentPattern(store.project);
      const arr = notesFor(pat, c.id);
      const idx = arr.findIndex((n) => n.t === i * STEP);
      if (mode === null) mode = idx < 0;
      if (mode && idx < 0) {
        arr.push({ t: i * STEP, len: STEP, key: 60, vel: 0.78 });
        engine.preview(c, 60, 0.78, 0.2);
      } else if (!mode && idx >= 0) arr.splice(idx, 1);
      store.emit();
    };
    container.addEventListener('pointerdown', (e) => {
      const t = e.target.closest('.step');
      if (!t) return;
      e.preventDefault();
      container.setPointerCapture(e.pointerId);
      store.commit();
      mode = null;
      seen.clear();
      toggle(t);
    });
    container.addEventListener('pointermove', (e) => {
      if (mode === null) return;
      const t = document.elementFromPoint(e.clientX, e.clientY);
      if (t && t.classList.contains('step') && container.contains(t)) toggle(t);
    });
    const end = () => {
      mode = null;
    };
    container.addEventListener('pointerup', end);
    container.addEventListener('pointercancel', end);
  }

  function drawMini(canvas, notes) {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width));
    const hh = Math.max(1, Math.floor(r.height));
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== w * dpr) {
      canvas.width = w * dpr;
      canvas.height = hh * dpr;
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#263034';
    g.fillRect(0, 0, w, hh);
    const L = patternLength(currentPattern(store.project));
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let b = BAR; b < L; b += BAR) g.fillRect(Math.round((b / L) * w), 0, 1, hh);
    if (!notes.length) return;
    let lo = Infinity;
    let hi = -Infinity;
    for (const n of notes) {
      lo = Math.min(lo, n.key);
      hi = Math.max(hi, n.key);
    }
    const span = Math.max(12, hi - lo + 1);
    const mid = (lo + hi) / 2;
    const base = mid - span / 2;
    const rowH = (hh - 6) / span;
    g.fillStyle = '#8fd17c';
    for (const n of notes) {
      const x = (n.t / L) * w;
      const ww = Math.max(2, (n.len / L) * w - 1);
      const y = hh - 3 - (n.key - base + 1) * rowH;
      g.fillRect(x, y, ww, Math.max(2, rowH - 1));
    }
  }

  function patch() {
    const pat = currentPattern(store.project);
    for (const r of rows) {
      const c = r.c;
      r.mute.update(!c.mute);
      r.pan.update(c.pan);
      r.vol.update(c.vol);
      r.row.classList.toggle('current', ui.prChannel === c.id);
      const notes = notesOf(pat, c.id);
      if (r.stepMode) {
        const on = new Set(notes.map((n) => n.t / STEP));
        r.stepEls.forEach((s, i) => s.classList.toggle('on', on.has(i)));
      } else drawMini(r.body, notes);
    }
    const bars = patternLength(pat) / BAR;
    stepsInfo.textContent = pat.name + ', ' + bars + (bars > 1 ? ' mesures' : ' mesure');
  }

  function signature() {
    const p = store.project;
    const pat = currentPattern(p);
    return [store.gen, pat.id, stepCount(), ...p.channels.map((c) => [c.id, c.name, c.instrument, c.insert, isStepChannel(notesOf(pat, c.id))].join(':'))].join('|');
  }

  function insertMenu(anchor, c) {
    const items = store.project.mixer.map((m, i) => ({
      label: i === 0 ? 'Master' : i + '  ' + m.name,
      checked: c.insert === i,
      onClick: () => store.change(() => { c.insert = i; }),
    }));
    openMenu(anchor, items);
  }

  function channelMenu(anchor, c, index) {
    ui.prChannel = c.id;
    store.emit();
    const p = store.project;
    openMenu(anchor, [
      { label: 'Piano roll', icon: 'Piano', onClick: () => actions.openPianoRoll(c.id) },
      { label: 'Paramètres du canal', icon: 'Settings', onClick: () => actions.channelSettings(c.id) },
      { label: 'Renommer', icon: 'Pencil', onClick: async () => {
        const v = await promptText('Renommer le canal', c.name);
        if (v) store.change(() => { c.name = v; });
      } },
      { label: 'Cloner', icon: 'Copy', onClick: () => store.change((pp) => {
        const copy = JSON.parse(JSON.stringify(c));
        copy.id = makeChannel(c.instrument, c.name).id;
        copy.name = c.name + ' 2';
        pp.channels.splice(index + 1, 0, copy);
      }) },
      { sep: true },
      { label: 'Monter', icon: 'ChevronUp', disabled: index === 0, onClick: () => store.change((pp) => {
        pp.channels.splice(index - 1, 0, pp.channels.splice(index, 1)[0]);
      }) },
      { label: 'Descendre', icon: 'ChevronDown', disabled: index === p.channels.length - 1, onClick: () => store.change((pp) => {
        pp.channels.splice(index + 1, 0, pp.channels.splice(index, 1)[0]);
      }) },
      { sep: true },
      { label: 'Vider les notes de ce motif', icon: 'Eraser', onClick: () => store.change((pp) => {
        currentPattern(pp).notes[c.id] = [];
      }) },
      { label: 'Supprimer le canal', icon: 'Trash', onClick: async () => {
        if (!(await confirmBox('Supprimer le canal', 'Le canal « ' + c.name + ' » et ses notes dans tous les motifs seront supprimés.', 'Supprimer'))) return;
        store.change((pp) => {
          pp.channels = pp.channels.filter((x) => x.id !== c.id);
          for (const pt of pp.patterns) delete pt.notes[c.id];
        });
      } },
    ]);
  }

  return {
    el,
    update() {
      const s = signature();
      if (s !== sig) {
        sig = s;
        build();
      } else patch();
    },
    frame() {
      let cur = -1;
      if (engine.playing && !ui.songMode) cur = Math.floor(engine.position() / STEP);
      if (cur === lastStep) return;
      lastStep = cur;
      for (const r of rows) {
        r.stepEls.forEach((s, i) => s.classList.toggle('play', i === cur));
      }
    },
    redrawMinis() {
      sig = '';
    },
  };
}
