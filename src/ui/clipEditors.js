import { h, openModal, dropdown, hint } from './dom.js';
import { attachPointer, fitCanvas } from './pointer.js';
import { store, clipLength } from '../store.js';
import { BAR, BEAT, STEP, clamp } from '../constants.js';
import { autoLabel, autoValue, formatTarget } from '../automation.js';
import { currentTheme } from '../themes.js';
import { t } from '../i18n.js';

// Curve shapes that replace the points of an automation clip.
const SHAPES = [
  { id: 'flat', name: 'Flat (current value)' },
  { id: 'up', name: 'Ramp up' },
  { id: 'down', name: 'Ramp down' },
  { id: 'sine1', name: 'Sine, 1 bar' },
  { id: 'sine2', name: 'Sine, 2 beats' },
  { id: 'saw', name: 'Saw, 1 beat' },
  { id: 'square', name: 'Square, 2 beats' },
];

export function shapePoints(id, len, v0 = 0.5) {
  if (id === 'flat') return [[0, v0], [len, v0]];
  if (id === 'up') return [[0, 0], [len, 1]];
  if (id === 'down') return [[0, 1], [len, 0]];
  const pts = [];
  if (id === 'sine1' || id === 'sine2') {
    const period = id === 'sine1' ? BAR : BEAT * 2;
    for (let x = 0; x <= len; x += period / 8) pts.push([Math.round(x), 0.5 + 0.5 * Math.sin((x / period) * Math.PI * 2)]);
  } else if (id === 'saw') {
    for (let x = 0; x < len; x += BEAT) pts.push([x, 1], [Math.min(len, x + BEAT - 1), 0]);
  } else if (id === 'square') {
    const half = BEAT;
    for (let x = 0, hi = true; x < len; x += half, hi = !hi) pts.push([x, hi ? 1 : 0], [Math.min(len, x + half - 1), hi ? 1 : 0]);
  }
  return pts.slice(0, 512);
}

export function openAutomationEditor(clip) {
  const cv = h('canvas', { class: 'cv', 'aria-label': t('Automation curve') });
  const wrap = h('div', { class: 'auto-wrap' }, cv);
  const info = h('span', { class: 'rack-info' });
  let W = 0;
  let H = 0;
  let dpr = 1;
  let g = null;
  const PAD = 10;
  store.commit();
  const len = () => clipLength(store.project, clip);
  const xAt = (tk) => PAD + (tk / len()) * (W - 2 * PAD);
  const tkAt = (x) => clamp(Math.round((((x - PAD) / (W - 2 * PAD)) * len()) / (STEP / 2)) * (STEP / 2), 0, len());
  const yAt = (v) => PAD + (1 - v) * (H - 2 * PAD);
  const vAt = (y) => clamp(1 - (y - PAD) / (H - 2 * PAD), 0, 1);
  const pointAt = (p) => clip.points.findIndex(([tk, v]) => Math.hypot(xAt(tk) - p.x, yAt(v) - p.y) < 14);

  function draw() {
    if (!g) return;
    const th = currentTheme();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = th.editor.gridWhite;
    g.fillRect(0, 0, W, H);
    for (let b = 0; b <= len(); b += BEAT) {
      g.fillStyle = b % BAR === 0 ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.2)';
      g.fillRect(Math.round(xAt(b)), 0, 1, H);
    }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, Math.round(yAt(0.5)), W, 1);
    g.strokeStyle = th.editor.note;
    g.lineWidth = 2;
    g.beginPath();
    const n = Math.max(2, Math.floor(W / 2));
    for (let i = 0; i <= n; i++) {
      const tk = (len() * i) / n;
      const y = yAt(autoValue(clip.points, tk));
      if (i === 0) g.moveTo(xAt(tk), y);
      else g.lineTo(xAt(tk), y);
    }
    g.stroke();
    g.fillStyle = th.editor.noteSelected;
    for (const [tk, v] of clip.points) g.fillRect(xAt(tk) - 4, yAt(v) - 4, 8, 8);
  }

  function sortPoints() {
    clip.points.sort((a, b) => a[0] - b[0]);
  }

  function show(v, tk) {
    info.textContent = t('Bar ') + (Math.floor(tk / BAR) + 1) + ', ' + formatTarget(clip.target, v);
  }

  attachPointer(cv, {
    down(p, st) {
      st.idx = pointAt(p);
      if (st.button === 2 && st.idx >= 0 && clip.points.length > 1) {
        clip.points.splice(st.idx, 1);
        st.idx = -1;
        st.removed = true;
        store.emit();
        draw();
      }
    },
    tap(p, st) {
      if (st.removed || st.idx >= 0) return;
      const pt = [tkAt(p.x), vAt(p.y)];
      clip.points.push(pt);
      sortPoints();
      show(pt[1], pt[0]);
      store.emit();
      draw();
    },
    dragStart(p0, p, st) {
      if (st.idx < 0) {
        const pt = [tkAt(p0.x), vAt(p0.y)];
        clip.points.push(pt);
        sortPoints();
        st.idx = clip.points.indexOf(pt);
      }
      st.pt = clip.points[st.idx];
    },
    dragMove(p, st) {
      if (!st.pt) return;
      st.pt[0] = tkAt(p.x);
      st.pt[1] = vAt(p.y);
      sortPoints();
      show(st.pt[1], st.pt[0]);
      store.emit();
      draw();
    },
    longPress(p) {
      const i = pointAt(p);
      if (i >= 0 && clip.points.length > 1) {
        clip.points.splice(i, 1);
        hint(t('Point deleted'));
        store.emit();
        draw();
      }
    },
  });
  fitCanvas(cv, (w, hh, r) => {
    W = w;
    H = hh;
    dpr = r;
    g = cv.getContext('2d');
    draw();
  });

  const shapes = dropdown({
    label: t('Shape'),
    value: null,
    options: SHAPES.map((s) => ({ value: s.id, label: t(s.name) })),
    onChange: (v) => {
      clip.points = shapePoints(v, len(), autoValue(clip.points, 0));
      store.emit();
      draw();
    },
  });
  openModal({
    title: t('Automation: ') + autoLabel(store.project, clip.target),
    wide: true,
    body: h('div', { class: 'auto-ed' },
      h('p', { class: 'set-note' }, t('Tap to add a point, drag a point to move it, long press (or right click) a point to delete it. The curve plays in SONG mode.')),
      h('div', { class: 'set-inline' }, h('span', null, t('Shape')), shapes, info),
      wrap,
    ),
  });
}

// Gain, pitch and fades of an audio clip.
export function openClipProperties(clip) {
  store.commit();
  const set = (fn) => {
    fn();
    store.emit();
  };
  const range = (label, min, max, step, value, fmt, onInput) => {
    const out = h('output', null, fmt(value));
    const input = h('input', { type: 'range', class: 'range', min, max, step, value, onInput: (e) => {
      const v = Number(e.target.value);
      out.textContent = fmt(v);
      onInput(v);
    } });
    return h('label', { class: 'field' }, h('span', null, label), h('div', { class: 'rangebox' }, input, out));
  };
  const steps = (v) => (v ? v / STEP + ' ' + t('steps') : t('none'));
  const len = clipLength(store.project, clip);
  openModal({
    title: t('Clip properties'),
    body: h('div', { class: 'form' },
      range(t('Gain'), 0, 2, 0.01, clip.gain == null ? 1 : clip.gain, (v) => (v <= 0 ? '-inf dB' : (20 * Math.log10(v)).toFixed(1) + ' dB'), (v) => set(() => { clip.gain = v; })),
      range(t('Pitch'), -24, 24, 1, clip.pitch || 0, (v) => (v > 0 ? '+' : '') + v + t(' semitones'), (v) => set(() => { clip.pitch = v; })),
      range(t('Fade in'), 0, Math.min(len, BAR * 4), STEP, clip.fadeIn || 0, steps, (v) => set(() => { clip.fadeIn = v; })),
      range(t('Fade out'), 0, Math.min(len, BAR * 4), STEP, clip.fadeOut || 0, steps, (v) => set(() => { clip.fadeOut = v; })),
      range(t('Start offset'), 0, BAR * 8, STEP, clip.offset || 0, steps, (v) => set(() => { clip.offset = v; })),
      h('p', { class: 'set-note' }, t('Pitch resamples the clip: it also changes its speed, like the resample mode in FL Studio.')),
    ),
  });
}
