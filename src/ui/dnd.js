import { h, icon } from './dom.js';

// Drag and drop from the browser to the playlist, piano roll and channel rack.
// Works with touch and mouse. A target is { el, accepts(item), over(item, p), leave(), drop(item, p) }
// where p is the pointer position relative to target.el.
const targets = new Set();
let drag = null;

export function registerDrop(target) {
  targets.add(target);
}

function targetAt(item, x, y) {
  const under = document.elementFromPoint(x, y);
  if (!under) return null;
  for (const t of targets) {
    if (t.el.isConnected && t.el.offsetParent !== null && t.el.contains(under) && t.accepts(item)) return t;
  }
  return null;
}

const local = (t, x, y) => {
  const r = t.el.getBoundingClientRect();
  return { x: x - r.left, y: y - r.top };
};

function move(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY - 18}px)`;
  const t = targetAt(drag.item, e.clientX, e.clientY);
  if (drag.target && drag.target !== t) drag.target.leave && drag.target.leave();
  drag.target = t;
  drag.ghost.classList.toggle('ok', !!t);
  if (t && t.over) t.over(drag.item, local(t, e.clientX, e.clientY));
}

// Once a drag has started, the browser must not scroll the list under the finger.
const blockScroll = (e) => {
  if (e.cancelable) e.preventDefault();
};

function end(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  drag = null;
  window.removeEventListener('pointermove', move, true);
  window.removeEventListener('pointerup', end, true);
  window.removeEventListener('pointercancel', end, true);
  window.removeEventListener('touchmove', blockScroll, { capture: true });
  d.ghost.remove();
  document.body.classList.remove('dragging');
  const t = e.type === 'pointerup' ? targetAt(d.item, e.clientX, e.clientY) : null;
  if (d.target && d.target.leave) d.target.leave();
  if (t) t.drop(d.item, local(t, e.clientX, e.clientY));
}

// item: { kind: 'sample' | 'instrument', id, name }
export function startDrag(item, e) {
  if (drag) return;
  const ghost = h('div', { class: 'drag-ghost' }, icon(item.kind === 'sample' ? 'AudioWaveform' : 'Music', 14), item.name);
  ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY - 18}px)`;
  document.body.append(ghost);
  document.body.classList.add('dragging');
  drag = { item, ghost, pointerId: e.pointerId, target: null };
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', end, true);
  window.addEventListener('pointercancel', end, true);
  window.addEventListener('touchmove', blockScroll, { capture: true, passive: false });
}

export const isDragging = () => !!drag;
