import { h, btn, icon, hint, openMenu, closeMenu, promptText, confirmBox, dropdown } from './dom.js';
import { knob, led } from './controls.js';
import { store, currentPattern, notesOf, notesFor, patternLength, isStepChannel, makeChannel } from '../store.js';
import { ui } from '../ui-state.js';
import { STEP, BAR, clamp, PATTERN_COLORS } from '../constants.js';
import { CATALOG, CATEGORIES, instrumentName } from '../audio/catalog.js';
import { getSampleMeta } from '../samples.js';
import { registerDrop } from './dnd.js';
import { t } from '../i18n.js';
import { fillEach, shiftSteps, randomSteps } from '../notetools.js';

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

function freeInsert(p) {
  const used = new Set(p.channels.map((c) => c.insert));
  for (let i = 1; i < p.mixer.length; i++) if (!used.has(i)) return i;
  return 0;
}

// Mutate the project (caller commits). Returns the new channel or null when the rack is full.
export function createChannel(p, instId) {
  if (p.channels.length >= 64) return null;
  const c = makeChannel(instId, instrumentName(instId), freeInsert(p));
  p.channels.push(c);
  ui.prChannel = c.id;
  return c;
}

// Reuse the sampler channel of this sample, or create one (caller commits).
export function samplerChannel(p, sampleId) {
  let c = p.channels.find((x) => x.instrument === 'sampler' && x.sample === sampleId);
  if (!c) {
    if (p.channels.length >= 64) return null;
    const m = getSampleMeta(sampleId);
    c = makeChannel('sampler', m ? m.name : 'Sample', freeInsert(p));
    c.sample = sampleId;
    p.channels.push(c);
  }
  ui.prChannel = c.id;
  return c;
}

export function addChannel(instId, engine, onAdded) {
  if (store.project.channels.length >= 64) return;
  store.change((p) => createChannel(p, instId));
  hint(instrumentName(instId) + t(' added to the rack'));
  onAdded && onAdded();
}

export function addSampler(sampleId) {
  let c = null;
  store.change((p) => { c = samplerChannel(p, sampleId); });
  if (c) hint(c.name + t(' added to the rack'));
}

export function createRack(engine, actions) {
  const list = h('div', { class: 'rack-list' });
  const stepsInfo = h('span', { class: 'rack-info' });
  const swingKnob = knob({
    value: 0, min: 0, max: 1, def: 0, size: 26, label: t('Swing'),
    onStart: () => store.commit(),
    onInput: (v) => { currentPattern(store.project).swing = v; store.emit(); },
  });
  const velBtn = btn('AudioLines', t('Step velocity: drag up or down on a step'), () => {
    ui.rackVel = !ui.rackVel;
    hint(ui.rackVel ? t('Step velocity: drag up or down on a step') : t('Steps: tap to turn on or off'));
    velBtn.classList.toggle('on', ui.rackVel);
    el.classList.toggle('vel-mode', ui.rackVel);
  });
  const groupSel = dropdown({ label: t('Channel group'), value: '', options: [{ value: '', label: t('All channels') }], cls: 'group-dd', onChange: (v) => { ui.rackGroup = v; sig = ''; store.emit(); } });
  const head = h('div', { class: 'ptools' },
    h('div', { class: 'grp' }, h('span', { class: 'ptitle' }, 'Channel rack'), stepsInfo),
    h('div', { class: 'grp' }, velBtn, groupSel),
    h('div', { class: 'grp' },
      btn('Minus', t('Remove a bar'), () => changeBars(-1)),
      btn('Plus', t('Add a bar'), () => changeBars(1)),
    ),
    h('label', { class: 'grp swing' }, swingKnob, h('span', null, t('Swing'))),
  );
  const addBtn = h('button', { class: 'b tb rack-add', type: 'button', onClick: (e) => addChannelMenu(e.currentTarget, engine) }, icon('Plus', 16), t('Add channel'));
  const scroller = h('div', { class: 'rack-scroll' }, list, addBtn);
  const el = h('div', { class: 'panel rack' }, head, scroller);
  let rows = [];
  let sig = '';
  let tapTimer = null;
  let lastTap = { id: null, at: 0 };
  // A slow second tap can land on the channel menu, which opened over the name in the
  // meantime: it still counts as the double tap.
  document.addEventListener('pointerdown', (e) => {
    if (!lastTap.id || performance.now() - lastTap.at > 450 || !e.target.closest || !e.target.closest('.menu')) return;
    if (Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) > 40) return;
    const id = lastTap.id;
    lastTap = { id: null, at: 0 };
    e.preventDefault();
    e.stopImmediatePropagation();
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', swallow, true), 600);
    closeMenu();
    actions.channelSettings(id);
  }, true);
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
    const groups = [...new Set(p.channels.map((c) => c.group).filter(Boolean))].sort();
    if (ui.rackGroup && !groups.includes(ui.rackGroup)) ui.rackGroup = '';
    groupSel.setOptions([{ value: '', label: t('All channels') }, ...groups.map((gname) => ({ value: gname, label: gname }))], ui.rackGroup || '');
    groupSel.style.display = groups.length ? '' : 'none';
    rows = p.channels.map((c, ci) => ({ c, ci })).filter(({ c }) => !ui.rackGroup || c.group === ui.rackGroup).map(({ c, ci }) => {
      const notes = notesOf(pat, c.id);
      const stepMode = isStepChannel(notes);
      const mute = led(!c.mute, t('Channel enabled'), () => store.change(() => { c.mute = !c.mute; }));
      const pan = knob({
        value: c.pan, min: -1, max: 1, def: 0, size: 22, label: t('Pan ') + c.name,
        format: (v) => (Math.abs(v) < 0.01 ? t('Center') : Math.round(Math.abs(v) * 100) + '% ' + (v < 0 ? t('left') : t('right'))),
        onStart: () => store.commit(),
        onInput: (v) => { c.pan = v; store.emit(); },
      });
      const vol = knob({
        value: c.vol, min: 0, max: 1, def: 0.78, size: 22, label: 'Volume ' + c.name,
        onStart: () => store.commit(),
        onInput: (v) => { c.vol = v; store.emit(); },
      });
      const ins = h('button', { class: 'rack-ins', type: 'button', title: t('Mixer insert'), onClick: (e) => insertMenu(e.currentTarget, c) }, c.insert === 0 ? 'M' : String(c.insert));
      const missing = c.instrument === 'sampler' && !getSampleMeta(c.sample);
      // Tap: channel menu. Double tap: channel settings window, like FL Studio. The menu
      // waits a moment so the second tap of a double tap does not land on it.
      const name = h('button', { class: 'rack-name' + (c.instrument === 'sampler' ? ' sampler' : '') + (missing ? ' missing' : ''), type: 'button', title: (missing ? t('Sample missing on this device') : instrumentName(c.instrument)) + '. ' + t('Double tap: channel settings'), onClick: (e) => {
        const anchor = e.currentTarget;
        // Second tap on the same channel within 450 ms, by time and not by the pending
        // menu: fingers on a tablet are often slower than the menu delay, and the row
        // can be rebuilt between the two taps.
        const now = performance.now();
        if (lastTap.id === c.id && now - lastTap.at < 450) {
          lastTap = { id: null, at: 0 };
          clearTimeout(tapTimer);
          tapTimer = null;
          closeMenu();
          actions.channelSettings(c.id);
          return;
        }
        lastTap = { id: c.id, at: now, x: e.clientX, y: e.clientY };
        clearTimeout(tapTimer);
        tapTimer = setTimeout(() => {
          tapTimer = null;
          if (anchor.isConnected) channelMenu(anchor, c, ci);
        }, 260);
      } }, c.name);
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
        body = h('canvas', { class: 'mini', title: t('Open in piano roll'), onClick: () => actions.openPianoRoll(c.id) });
      }
      const row = h('div', { class: 'rack-row' + (ui.prChannel === c.id ? ' current' : ''), style: c.color != null ? { boxShadow: 'inset 4px 0 0 ' + PATTERN_COLORS[c.color] } : null }, mute, pan, vol, ins, name, body);
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
      if (mode === null || mode === undefined) mode = idx < 0;
      if (mode && idx < 0) {
        arr.push({ t: i * STEP, len: STEP, key: 60, vel: 0.78 });
        engine.preview(c, 60, 0.78, 0.2);
      } else if (!mode && idx >= 0) arr.splice(idx, 1);
      store.emit();
    };
    // Velocity mode: the height inside a step sets the velocity of its note.
    const setVel = (target, e) => {
      const i = Number(target.dataset.i);
      const n = notesFor(currentPattern(store.project), c.id).find((x) => x.t === i * STEP);
      if (!n) return;
      const r = target.getBoundingClientRect();
      n.vel = clamp(1 - (e.clientY - r.top) / r.height, 0.05, 1);
      hint(t('Velocity ') + Math.round(n.vel * 100) + '%');
      store.emit();
    };
    container.addEventListener('pointerdown', (e) => {
      const t = e.target.closest('.step');
      if (!t) return;
      e.preventDefault();
      container.setPointerCapture(e.pointerId);
      store.commit();
      seen.clear();
      if (ui.rackVel) {
        mode = 'vel';
        setVel(t, e);
        return;
      }
      mode = null;
      toggle(t);
    });
    container.addEventListener('pointermove', (e) => {
      if (mode === null) return;
      const t = document.elementFromPoint(e.clientX, e.clientY);
      if (!t || !t.classList.contains('step') || !container.contains(t)) return;
      if (mode === 'vel') setVel(t, e);
      else toggle(t);
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
        const vel = new Map(notes.map((n) => [n.t / STEP, n.vel]));
        r.stepEls.forEach((s, i) => {
          s.classList.toggle('on', vel.has(i));
          if (vel.has(i)) s.style.setProperty('--vel', String(vel.get(i)));
        });
      } else drawMini(r.body, notes);
    }
    const bars = patternLength(pat) / BAR;
    stepsInfo.textContent = pat.name + ', ' + bars + (bars > 1 ? t(' bars') : t(' bar'));
    swingKnob.update(pat.swing || 0);
  }

  function signature() {
    const p = store.project;
    const pat = currentPattern(p);
    return [store.gen, pat.id, stepCount(), ui.rackGroup || '', ...p.channels.map((c) => [c.id, c.name, c.instrument, c.insert, c.color, c.group, isStepChannel(notesOf(pat, c.id)), c.instrument === 'sampler' && !getSampleMeta(c.sample)].join(':'))].join('|');
  }

  function insertMenu(anchor, c) {
    const items = store.project.mixer.map((m, i) => ({
      label: i === 0 ? 'Master' : i + '  ' + m.name,
      checked: c.insert === i,
      onClick: () => store.change(() => { c.insert = i; }),
    }));
    openMenu(anchor, items);
  }

  function fill(c, every) {
    store.change((pp) => {
      const pat = currentPattern(pp);
      pat.notes[c.id] = fillEach(every, patternLength(pat));
    });
  }

  function shift(c, d) {
    store.change((pp) => {
      const pat = currentPattern(pp);
      shiftSteps(notesFor(pat, c.id), d, patternLength(pat));
    });
  }

  function channelMenu(anchor, c, index) {
    ui.prChannel = c.id;
    store.emit();
    const p = store.project;
    openMenu(anchor, [
      { label: 'Piano roll', icon: 'Piano', onClick: () => actions.openPianoRoll(c.id) },
      { label: t('Channel settings'), icon: 'Settings', onClick: () => actions.channelSettings(c.id) },
      { label: t('Rename'), icon: 'Pencil', onClick: async () => {
        const v = await promptText(t('Rename channel'), c.name);
        if (v) store.change(() => { c.name = v; });
      } },
      { label: t('Color') + '...', icon: 'Palette', onClick: () => openMenu(anchor, [
        { label: t('No color'), checked: c.color == null, onClick: () => store.change(() => { delete c.color; }) },
        ...PATTERN_COLORS.map((col, i) => ({ label: t('Color ') + (i + 1), checked: c.color === i, icon: 'Circle', onClick: () => store.change(() => { c.color = i; }) })),
      ]) },
      { label: t('Group') + (c.group ? ': ' + c.group : '...'), icon: 'Layers', onClick: async () => {
        const v = await promptText(t('Group name (empty for none)'), c.group || '');
        if (v == null) return;
        store.change(() => {
          if (v.trim()) c.group = v.trim().slice(0, 30);
          else delete c.group;
        });
      } },
      { label: t('Clone'), icon: 'Copy', onClick: () => store.change((pp) => {
        const copy = JSON.parse(JSON.stringify(c));
        copy.id = makeChannel(c.instrument, c.name).id;
        copy.name = c.name + ' 2';
        pp.channels.splice(index + 1, 0, copy);
      }) },
      { sep: true },
      { label: t('Move up'), icon: 'ChevronUp', disabled: index === 0, onClick: () => store.change((pp) => {
        pp.channels.splice(index - 1, 0, pp.channels.splice(index, 1)[0]);
      }) },
      { label: t('Move down'), icon: 'ChevronDown', disabled: index === p.channels.length - 1, onClick: () => store.change((pp) => {
        pp.channels.splice(index + 1, 0, pp.channels.splice(index, 1)[0]);
      }) },
      { sep: true },
      { label: t('Solo'), icon: 'Headphones', checked: !c.mute && p.channels.length > 1 && p.channels.every((x) => x === c || x.mute), onClick: () => store.change((pp) => {
        // FL Studio style solo: mute every other channel, or unmute all when already solo.
        const was = !c.mute && pp.channels.every((x) => x === c || x.mute);
        for (const x of pp.channels) x.mute = was ? false : x !== c;
      }) },
      { label: t('Fill each 2 steps'), icon: 'Grid3x3', onClick: () => fill(c, 2) },
      { label: t('Fill each 4 steps'), icon: 'Grid3x3', onClick: () => fill(c, 4) },
      { label: t('Fill each 8 steps'), icon: 'Grid3x3', onClick: () => fill(c, 8) },
      { label: t('Random steps'), icon: 'Shuffle', onClick: () => store.change((pp) => {
        const pat = currentPattern(pp);
        pat.notes[c.id] = randomSteps(patternLength(pat));
      }) },
      { label: t('Shift one step left'), icon: 'ChevronLeft', onClick: () => shift(c, -1) },
      { label: t('Shift one step right'), icon: 'ChevronRight', onClick: () => shift(c, 1) },
      { sep: true },
      { label: t('Clear notes in this pattern'), icon: 'Eraser', onClick: () => store.change((pp) => {
        currentPattern(pp).notes[c.id] = [];
      }) },
      { label: t('Delete channel'), icon: 'Trash', onClick: async () => {
        if (!(await confirmBox(t('Delete channel'), t('Channel “') + c.name + t('” and its notes in every pattern will be deleted.'), t('Delete')))) return;
        store.change((pp) => {
          pp.channels = pp.channels.filter((x) => x.id !== c.id);
          for (const pt of pp.patterns) delete pt.notes[c.id];
        });
      } },
    ]);
  }

  registerDrop({
    el: scroller,
    accepts: (item) => item.kind === 'sample' || item.kind === 'instrument',
    over: () => scroller.classList.add('drop-over'),
    leave: () => scroller.classList.remove('drop-over'),
    drop(item) {
      scroller.classList.remove('drop-over');
      if (item.kind === 'sample') addSampler(item.id);
      else addChannel(item.id, engine);
    },
  });

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
      if (engine.playing && !ui.songMode) cur = Math.floor(engine.heardPosition() / STEP);
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
