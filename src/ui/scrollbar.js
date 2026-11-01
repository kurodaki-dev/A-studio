// Scrollbars drawn on the editor canvases, like FL Studio's. They make
// left and right navigation possible with one finger.
export const SB = 16;

// Thumb position on a track [a, b] for a view of `view` pixels over `total` pixels scrolled by `scroll`.
export function thumb(a, b, view, total, scroll) {
  const track = b - a;
  const size = Math.max(28, Math.min(track, (track * view) / Math.max(total, view)));
  const max = Math.max(1, total - view);
  const pos = a + (track - size) * Math.min(1, Math.max(0, scroll / max));
  return { pos, size, track, max };
}

// Scroll value for a thumb whose start is at `pos`.
export function scrollAt(a, b, view, total, pos) {
  const { size, track, max } = thumb(a, b, view, total, 0);
  const f = (pos - a) / Math.max(1, track - size);
  return Math.min(max, Math.max(0, f * max));
}

export function drawScrollbar(g, horizontal, x, y, len, th, view, total, scroll, colors) {
  g.fillStyle = colors.track;
  if (horizontal) g.fillRect(x, y, len, th);
  else g.fillRect(x, y, th, len);
  const t = thumb(horizontal ? x : y, (horizontal ? x : y) + len, view, total, scroll);
  g.fillStyle = colors.thumb;
  if (horizontal) g.fillRect(Math.round(t.pos), y + 3, Math.round(t.size), th - 6);
  else g.fillRect(x + 3, Math.round(t.pos), th - 6, Math.round(t.size));
}
