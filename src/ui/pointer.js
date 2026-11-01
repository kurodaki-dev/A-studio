// Pointer handling for canvas editors: tap, drag, long press, right button,
// and two finger pan and zoom.
export function attachPointer(el, hd) {
  const pts = new Map();
  let st = null;
  let gs = null;
  let blocked = false;

  const loc = (e) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  el.addEventListener('contextmenu', (e) => e.preventDefault());

  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const p = loc(e);
    pts.set(e.pointerId, p);
    if (pts.size === 1 && !blocked) {
      st = { p0: p, last: p, started: false, done: false, button: e.button, touch: e.pointerType === 'touch', lp: null };
      if (hd.longPress && e.button === 0) {
        st.lp = setTimeout(() => {
          if (st && !st.started && !st.done) {
            st.done = true;
            hd.longPress(st.p0, st);
          }
        }, 500);
      }
      hd.down && hd.down(p, st, e);
    } else if (pts.size === 2) {
      if (st) {
        clearTimeout(st.lp);
        hd.cancel && hd.cancel(st);
        st = null;
      }
      blocked = true;
      const [a, b] = [...pts.values()];
      gs = { a, b, axis: Math.abs(a.x - b.x) >= Math.abs(a.y - b.y) ? 'x' : 'y' };
      hd.gestureStart && hd.gestureStart(gs);
    }
  });

  el.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) {
      hd.hover && hd.hover(loc(e), e);
      return;
    }
    const p = loc(e);
    pts.set(e.pointerId, p);
    if (gs) {
      if (pts.size < 2) return;
      const [a, b] = [...pts.values()];
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const pcx = (gs.a.x + gs.b.x) / 2;
      const pcy = (gs.a.y + gs.b.y) / 2;
      const dx0 = Math.max(30, Math.abs(gs.a.x - gs.b.x));
      const dy0 = Math.max(30, Math.abs(gs.a.y - gs.b.y));
      const dx1 = Math.max(30, Math.abs(a.x - b.x));
      const dy1 = Math.max(30, Math.abs(a.y - b.y));
      hd.gesture && hd.gesture({ cx, cy, dcx: cx - pcx, dcy: cy - pcy, sx: dx1 / dx0, sy: dy1 / dy0, axis: gs.axis });
      gs.a = a;
      gs.b = b;
      return;
    }
    if (!st || st.done) return;
    if (!st.started) {
      const d = Math.hypot(p.x - st.p0.x, p.y - st.p0.y);
      if (d < (st.touch ? 8 : 4)) return;
      st.started = true;
      clearTimeout(st.lp);
      hd.dragStart && hd.dragStart(st.p0, p, st, e);
    }
    hd.dragMove && hd.dragMove(p, st, e);
    st.last = p;
  });

  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = loc(e);
    pts.delete(e.pointerId);
    if (gs) {
      if (pts.size < 2) {
        gs = null;
        hd.gestureEnd && hd.gestureEnd();
      }
      if (pts.size === 0) blocked = false;
      return;
    }
    if (pts.size === 0) blocked = false;
    if (!st) return;
    clearTimeout(st.lp);
    const s = st;
    st = null;
    if (s.done) return;
    if (e.type === 'pointercancel') {
      hd.cancel && hd.cancel(s);
      return;
    }
    if (s.started) hd.dragEnd && hd.dragEnd(p, s, e);
    else hd.tap && hd.tap(p, s, e);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  if (hd.wheel) el.addEventListener('wheel', (e) => {
    e.preventDefault();
    hd.wheel(e, loc(e));
  }, { passive: false });
}

// Keep a canvas sized to its box at device pixel ratio.
export function fitCanvas(canvas, onResize) {
  const ro = new ResizeObserver(() => {
    const r = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(r.width));
    const hgt = Math.max(1, Math.floor(r.height));
    canvas.style.width = w + 'px';
    canvas.style.height = hgt + 'px';
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(hgt * dpr);
    onResize(w, hgt, dpr);
  });
  ro.observe(canvas.parentElement);
  return ro;
}
