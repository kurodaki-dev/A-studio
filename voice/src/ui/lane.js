// Parameter lane under the editor: draw the dynamics, pitch bend, breathiness, gender
// or tension curve of the track with the finger. Same time scale as the editor.
import { h, iconBtn } from './dom.js';
import { store, PPQ, CURVE_INFO, curveAt, drawCurve } from '../store.js';
import { KEY_W, ui } from './editor.js';
import { t } from '../i18n.js';

export const LANES = [
  ['dyn', 'Dynamics'],
  ['pit', 'Pitch bend'],
  ['bre', 'Breathiness'],
  ['gen', 'Gender'],
  ['ten', 'Tension'],
];

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim() || '#888';

export function createLane() {
  const cv = h('canvas', { class: 'cv', 'aria-label': t('Parameter lane') });
  const wrap = h('div', { class: 'cvwrap lane-wrap' }, cv);
  const tabs = h('div', { class: 'lane-tabs' }, LANES.map(([id, label]) => h('button', {
    class: 'lane-tab' + (ui.lane === id ? ' on' : ''), type: 'button', 'data-lane': id,
    onClick: () => { ui.lane = id; refreshTabs(); draw(); },
  }, t(label))), iconBtn('Eraser', t('Reset this curve'), () => {
    store.change(() => { delete store.track().curves[ui.lane]; });
  }, 'small'));
  const el = h('div', { class: 'lane' }, tabs, wrap);
  let W = 0;
  let H = 0;
  let dpr = 1;
  let g = null;
  const refreshTabs = () => tabs.querySelectorAll('.lane-tab').forEach((b) => b.classList.toggle('on', b.dataset.lane === ui.lane));

  const xAt = (tick) => KEY_W + tick * ui.px - ui.sx;
  const tickAt = (x) => Math.max(0, (x - KEY_W + ui.sx) / ui.px);
  const info = () => CURVE_INFO[ui.lane];
  const yOf = (v) => {
    const { min, max } = info();
    return 6 + (1 - (v - min) / (max - min)) * (H - 12);
  };
  const vOf = (y) => {
    const { min, max } = info();
    const f = 1 - (y - 6) / Math.max(1, H - 12);
    return Math.round(Math.max(min, Math.min(max, min + f * (max - min))));
  };

  function draw() {
    if (!g) return;
    const track = store.track();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = css('panel');
    g.fillRect(0, 0, W, H);
    // Note blocks for orientation.
    g.fillStyle = css('grid-line');
    for (const n of track.notes) {
      const x = xAt(n.t);
      g.fillRect(x, 0, Math.max(1, n.len * ui.px - 1), H);
    }
    // Default line and the curve.
    const { def } = info();
    g.fillStyle = css('line');
    g.fillRect(KEY_W, Math.round(yOf(def)), W - KEY_W, 1);
    const pts = track.curves[ui.lane] || [];
    g.strokeStyle = css('accent');
    g.lineWidth = 2;
    g.beginPath();
    for (let x = KEY_W; x <= W; x += 2) {
      const y = yOf(curveAt(pts, tickAt(x), def));
      if (x === KEY_W) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = css('panel2');
    g.fillRect(0, 0, KEY_W, H);
    g.fillStyle = css('dim');
    g.font = '10px system-ui, sans-serif';
    g.textBaseline = 'middle';
    const { min, max } = info();
    g.fillText(String(max), 6, 10);
    g.fillText(String(min), 6, H - 10);
  }

  let last = null;
  cv.addEventListener('pointerdown', (e) => {
    const r = cv.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (p.x < KEY_W) return;
    cv.setPointerCapture(e.pointerId);
    store.commit();
    last = p;
    paint(p, p);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!last) return;
    const r = cv.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    paint(last, p);
    last = p;
  });
  const up = () => {
    if (!last) return;
    last = null;
    store.emit();
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);

  function paint(a, b) {
    const track = store.track();
    track.curves[ui.lane] = drawCurve(track.curves[ui.lane] || [], Math.round(tickAt(a.x)), vOf(a.y), Math.round(tickAt(b.x)), vOf(b.y), PPQ / 48);
    draw();
  }

  new ResizeObserver(() => {
    const r = wrap.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width;
    H = r.height;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    g = cv.getContext('2d');
    draw();
  }).observe(wrap);

  return { el, draw };
}
