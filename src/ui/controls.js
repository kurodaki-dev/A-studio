import { h, hint, openMenu } from './dom.js';
import { t } from '../i18n.js';
import { clamp } from '../constants.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

// MIDI learn: a controller knob (CC number) is linked to a control by its label.
// The link is kept on the device and works whenever that control is on screen.
const MAP_KEY = 'astudio:midimap';
const targets = new Map(); // label -> { el, apply(v01) }
let learning = null;
function readMap() {
  try {
    const m = JSON.parse(localStorage.getItem(MAP_KEY) || '{}');
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}
function writeMap(m) {
  try {
    localStorage.setItem(MAP_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}
export function midiLearning() {
  return learning;
}
// Called by the MIDI input for every control change. Returns true when used.
export function handleMidiCC(cc, value) {
  const map = readMap();
  if (learning) {
    for (const k of Object.keys(map)) if (map[k] === learning) delete map[k];
    map[cc] = learning;
    writeMap(map);
    hint(t('MIDI control ') + cc + ' → ' + learning);
    learning = null;
    return true;
  }
  const label = map[cc];
  const tg = label && targets.get(label);
  if (!tg || !tg.el.isConnected) return false;
  tg.apply(value / 127);
  return true;
}

// Vertical drag helper shared by knobs and faders.
function dragValue(el, { get, set, min, max, def, range = 160, label, format, onStart }) {
  let start = null;
  let lastTap = 0;
  let lastCc = 0;
  if (label) {
    targets.set(label, {
      el,
      apply(v01) {
        const now = performance.now();
        if (now - lastCc > 800) onStart && onStart();
        lastCc = now;
        const v = min + v01 * (max - min);
        set(v);
        hint(label + ' : ' + format(v));
      },
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const map = readMap();
      const linked = Object.keys(map).find((k) => map[k] === label);
      openMenu(el, [
        { header: label },
        { label: t('MIDI learn: move a knob on your controller'), icon: 'Keyboard', onClick: () => { learning = label; hint(t('Move a knob or fader on the MIDI controller')); } },
        ...(linked ? [{ label: t('Forget MIDI control ') + linked, icon: 'Trash', onClick: () => { delete map[linked]; writeMap(map); } }] : []),
      ]);
    });
  }
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const now = performance.now();
    if (now - lastTap < 300) {
      onStart && onStart();
      set(def);
      hint(label + ' : ' + format(def));
      lastTap = 0;
      start = null;
      return;
    }
    lastTap = now;
    start = { y: e.clientY, v: get(), began: false };
    hint(label + ' : ' + format(get()));
  });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dy = start.y - e.clientY;
    if (!start.began) {
      if (Math.abs(dy) < 3) return;
      start.began = true;
      onStart && onStart();
    }
    const v = clamp(start.v + (dy / range) * (max - min), min, max);
    set(v);
    hint(label + ' : ' + format(v));
  });
  const end = () => {
    start = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

export function knob({ value, min = 0, max = 1, def = 0, size = 24, label, format = (v) => Math.round(v * 100) + '%', onStart, onInput }) {
  const el = h('div', { class: 'knob', role: 'slider', 'aria-label': label, title: label, style: { width: size + 'px', height: size + 'px' } });
  const s = svg('svg', { width: size, height: size, viewBox: '0 0 24 24' });
  const bg = svg('circle', { cx: 12, cy: 12, r: 10, class: 'knob-bg' });
  const arc = svg('path', { class: 'knob-arc', fill: 'none' });
  const line = svg('line', { x1: 12, y1: 12, x2: 12, y2: 3, class: 'knob-line' });
  s.append(bg, arc, line);
  el.append(s);
  let cur = value;
  const bipolar = min < 0;
  const polar = (a, r) => [12 + r * Math.sin(a), 12 - r * Math.cos(a)];
  function draw() {
    const frac = (cur - min) / (max - min);
    const a = -2.4 + frac * 4.8;
    const [x, y] = polar(a, 8);
    line.setAttribute('x2', x.toFixed(2));
    line.setAttribute('y2', y.toFixed(2));
    const a0 = bipolar ? 0 : -2.4;
    const [sx, sy] = polar(a0, 10);
    const [ex, ey] = polar(a, 10);
    const large = Math.abs(a - a0) > Math.PI ? 1 : 0;
    const sweep = a > a0 ? 1 : 0;
    arc.setAttribute('d', Math.abs(a - a0) < 0.01 ? '' : `M${sx.toFixed(2)} ${sy.toFixed(2)} A10 10 0 ${large} ${sweep} ${ex.toFixed(2)} ${ey.toFixed(2)}`);
    el.setAttribute('aria-valuenow', String(cur));
  }
  draw();
  dragValue(el, {
    get: () => cur,
    set: (v) => {
      cur = v;
      draw();
      onInput(v);
    },
    min,
    max,
    def,
    label,
    format,
    onStart,
  });
  el.update = (v) => {
    if (v !== cur) {
      cur = v;
      draw();
    }
  };
  return el;
}

export function fader({ value, label, format, onStart, onInput, def = 0.8 }) {
  const el = h('div', { class: 'fader', role: 'slider', 'aria-label': label, title: label });
  const groove = h('div', { class: 'fader-groove' });
  const thumb = h('div', { class: 'fader-thumb' });
  el.append(groove, thumb);
  let cur = value;
  function draw() {
    thumb.style.bottom = `calc(${(cur * 100).toFixed(2)}% - ${(cur * 14).toFixed(2)}px)`;
  }
  draw();
  dragValue(el, {
    get: () => cur,
    set: (v) => {
      cur = v;
      draw();
      onInput(v);
    },
    min: 0,
    max: 1,
    def,
    range: 120,
    label,
    format,
    onStart,
  });
  el.update = (v) => {
    if (v !== cur) {
      cur = v;
      draw();
    }
  };
  return el;
}

export function led(on, title, onClick) {
  const el = h('button', { class: 'led' + (on ? ' on' : ''), title, 'aria-label': title, 'aria-pressed': String(!!on), type: 'button', onClick });
  el.update = (v) => {
    el.classList.toggle('on', !!v);
    el.setAttribute('aria-pressed', String(!!v));
  };
  return el;
}
