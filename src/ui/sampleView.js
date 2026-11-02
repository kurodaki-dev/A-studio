import { h, icon, hint } from './dom.js';
import { attachPointer, fitCanvas } from './pointer.js';
import { getBuffer, loadBuffer, addSample } from '../samples.js';
import { reverseBuffer, renderNote } from '../audio/engine.js';
import { encodeWav } from '../wav.js';
import { currentTheme } from '../themes.js';
import { t } from '../i18n.js';

// Peaks (min, max) per column of a buffer, both channels mixed.
function peaks(buf, cols) {
  const n = buf.length;
  const out = new Float32Array(cols * 2);
  const chs = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  for (let x = 0; x < cols; x++) {
    const a = Math.floor((x / cols) * n);
    const b = Math.max(a + 1, Math.floor(((x + 1) / cols) * n));
    let lo = 0;
    let hi = 0;
    for (let i = a; i < b; i += Math.max(1, Math.floor((b - a) / 200))) {
      let v = 0;
      for (const c of chs) v += c[i];
      v /= chs.length;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    out[x * 2] = lo;
    out[x * 2 + 1] = hi;
  }
  return out;
}

function drawWave(g, W, H, pk, color) {
  const cols = pk.length / 2;
  g.fillStyle = color;
  for (let x = 0; x < cols; x++) {
    const lo = pk[x * 2];
    const hi = pk[x * 2 + 1];
    const y0 = H / 2 - hi * H * 0.46;
    const y1 = H / 2 - lo * H * 0.46;
    g.fillRect((x / cols) * W, y0, Math.max(1, W / cols), Math.max(1, y1 - y0));
  }
}

// Waveform of a sampler channel: drag the start and end handles to cut the sound,
// the small handles inside for the fades, the numbered lines for the slices. Tap to
// listen from that point, long press to add a slice (or remove the one under the finger).
export function sampleView({ c, engine, set, onEdit }) {
  const cv = h('canvas', { class: 'cv', 'aria-label': t('Sample waveform') });
  const wrap = h('div', { class: 'sample-wrap' }, cv);
  const info = h('span', { class: 'rack-info' });
  let W = 0;
  let H = 0;
  let dpr = 1;
  let g = null;
  let buf = null;
  let pk = null;
  let playing = null;
  const p = c.params;
  const fr = (x) => Math.max(0, Math.min(1, x / W));
  const xOf = (f) => f * W;
  const segLen = () => Math.max(0.001, (p.end == null ? 1 : p.end) - (p.start || 0));

  function handles() {
    const a = p.start || 0;
    const b = p.end == null ? 1 : p.end;
    const list = [
      { id: 'start', x: xOf(a) },
      { id: 'end', x: xOf(b) },
      { id: 'fadeIn', x: xOf(a + (p.fadeIn || 0) * segLen()), y: 14 },
      { id: 'fadeOut', x: xOf(b - (p.fadeOut || 0) * segLen()), y: 14 },
    ];
    (c.slices || []).forEach((sv, i) => list.push({ id: 'slice', index: i, x: xOf(sv) }));
    return list;
  }

  function draw() {
    if (!g) return;
    const th = currentTheme();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = th.colors.input;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, H / 2, W, 1);
    if (!buf) {
      g.fillStyle = th.colors.dim;
      g.font = '12px system-ui, sans-serif';
      g.fillText(t('Loading the sample...'), 10, H / 2 - 6);
      return;
    }
    if (!pk || pk.length !== Math.floor(W) * 2) pk = peaks(p.reverse ? reverseBuffer(engine.init(), buf) : buf, Math.floor(W));
    drawWave(g, W, H, pk, th.editor.note);
    const a = xOf(p.start || 0);
    const b = xOf(p.end == null ? 1 : p.end);
    // Parts that are not played are dimmed.
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, 0, a, H);
    g.fillRect(b, 0, W - b, H);
    // Fades
    const fi = xOf((p.start || 0) + (p.fadeIn || 0) * segLen());
    const fo = xOf((p.end == null ? 1 : p.end) - (p.fadeOut || 0) * segLen());
    g.strokeStyle = th.colors.text;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(a, H);
    g.lineTo(fi, 14);
    g.lineTo(fo, 14);
    g.lineTo(b, H);
    g.stroke();
    g.fillStyle = th.colors.text;
    for (const x of [fi, fo]) g.fillRect(x - 4, 10, 8, 8);
    // Start and end
    g.fillStyle = th.colors.accent;
    for (const x of [a, b]) {
      g.fillRect(x - 1, 0, 2, H);
      g.fillRect(x - 7, H - 18, 14, 18);
    }
    g.fillStyle = '#1b1206';
    g.font = 'bold 11px system-ui, sans-serif';
    g.fillText('S', a - 4, H - 5);
    g.fillText('E', b - 4, H - 5);
    // Slices
    g.font = '10px system-ui, sans-serif';
    (c.slices || []).forEach((sv, i) => {
      const x = xOf(sv);
      g.fillStyle = 'rgba(143,209,124,0.9)';
      g.fillRect(x, 0, 1, H);
      g.fillText(String(i + 1), x + 3, 26);
    });
    // Playhead
    if (playing) {
      const ctx = engine.init();
      const el = ctx.currentTime - playing.at;
      if (el >= 0 && el <= playing.duration) {
        const pos = (playing.start + el) / playing.total;
        g.fillStyle = th.editor.playhead;
        g.fillRect(xOf(pos), 0, 2, H);
      }
      if (el > playing.duration) playing = null;
      requestAnimationFrame(draw);
    }
    const dur = buf.duration * segLen();
    info.textContent = t('Played part: ') + dur.toFixed(2) + ' s ' + t('of') + ' ' + buf.duration.toFixed(2) + ' s' + ((c.slices || []).length ? ', ' + c.slices.length + t(' slices') : '');
  }

  async function listen(from) {
    const to = p.end == null ? 1 : p.end;
    playing = await engine.playSampleRange(c.sample, from, to, !!p.reverse);
    draw();
  }

  attachPointer(cv, {
    down(pt, st) {
      // The top strip grabs the fade squares, the rest the start, end and slices.
      const top = pt.y < 30;
      let best = null;
      for (const hd of handles()) {
        if ((hd.y != null) !== top) continue;
        const d = Math.abs(hd.x - pt.x);
        if (d < 16 && (!best || d < best.d)) best = { ...hd, d };
      }
      st.h = best;
    },
    tap(pt, st) {
      if (st.h && st.h.id !== 'slice') return;
      listen(Math.max(p.start || 0, fr(pt.x)));
    },
    dragMove(pt, st) {
      if (!st.h) return;
      const f = fr(pt.x);
      const a = p.start || 0;
      const b = p.end == null ? 1 : p.end;
      set(() => {
        if (st.h.id === 'start') p.start = Math.min(f, b - 0.002);
        else if (st.h.id === 'end') p.end = Math.max(f, a + 0.002);
        else if (st.h.id === 'fadeIn') p.fadeIn = Math.max(0, Math.min(0.5, (f - a) / segLen()));
        else if (st.h.id === 'fadeOut') p.fadeOut = Math.max(0, Math.min(0.5, (b - f) / segLen()));
        else if (st.h.id === 'slice') {
          const s = c.slices;
          const lo = st.h.index > 0 ? s[st.h.index - 1] + 0.002 : 0;
          const hi = st.h.index < s.length - 1 ? s[st.h.index + 1] - 0.002 : 1;
          s[st.h.index] = Math.max(lo, Math.min(hi, f));
        }
      });
      draw();
    },
    longPress(pt) {
      const f = fr(pt.x);
      set(() => {
        const s = c.slices ? c.slices.slice() : [0];
        const near = s.findIndex((v) => Math.abs(xOf(v) - pt.x) < 12);
        if (near > 0) s.splice(near, 1);
        else if (near < 0) s.push(f);
        s.sort((x, y) => x - y);
        if (s.length > 1) c.slices = s;
        else delete c.slices;
      });
      hint(c.slices ? c.slices.length + t(' slices: C5 plays the first one, C#5 the second, and so on.') : t('Slices removed'));
      draw();
    },
  });
  fitCanvas(cv, (w, hh, r) => {
    W = w;
    H = hh;
    dpr = r;
    g = cv.getContext('2d');
    pk = null;
    draw();
  });

  (async () => {
    buf = getBuffer(c.sample) || (await loadBuffer(c.sample));
    pk = null;
    draw();
  })();

  const btn = (ic, label, fn) => h('button', { class: 'b tb', type: 'button', onClick: fn }, icon(ic, 16), label);
  return h('div', { class: 'sample-view' },
    wrap,
    h('div', { class: 'set-inline' },
      btn('Play', t('Play the part'), () => listen(p.start || 0)),
      btn('RefreshCw', t('Reset start, end and fades'), () => { set(() => { p.start = 0; p.end = 1; p.fadeIn = 0; p.fadeOut = 0; }); draw(); }),
      onEdit ? btn('Scissors', t('Edit audio (cut, clean up)'), onEdit) : null,
      info,
    ),
    h('p', { class: 'set-note' }, t('Drag S and E to choose the part that plays, the small squares for the fades. Tap to listen from a point. Long press adds a slice, or removes the one under your finger.')),
  );
}

// Waveform of a synthesized sound (one C5 note) with a button to turn it into a sample.
export function soundView({ project, c, onMakeSample }) {
  const cv = h('canvas', { class: 'cv', 'aria-label': t('Sound waveform') });
  const wrap = h('div', { class: 'sample-wrap short' }, cv);
  let W = 0;
  let H = 0;
  let dpr = 1;
  let g = null;
  let buf = null;
  let busy = true;
  function draw() {
    if (!g) return;
    const th = currentTheme();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = th.colors.input;
    g.fillRect(0, 0, W, H);
    if (!buf) {
      g.fillStyle = th.colors.dim;
      g.font = '12px system-ui, sans-serif';
      g.fillText(busy ? t('Rendering the sound...') : t('No preview for code plugins'), 10, H / 2);
      return;
    }
    drawWave(g, W, H, peaks(buf, Math.floor(W)), th.editor.note);
  }
  fitCanvas(cv, (w, hh, r) => {
    W = w;
    H = hh;
    dpr = r;
    g = cv.getContext('2d');
    draw();
  });
  const refresh = async () => {
    busy = true;
    buf = null;
    draw();
    buf = await renderNote(project, c, 1.6).catch(() => null);
    busy = false;
    draw();
  };
  refresh();
  const make = async () => {
    const b = buf || (await renderNote(project, c, 2));
    if (!b) return hint(t('No preview for code plugins'));
    const id = await addSample(c.name + ' C5', 'Renders', encodeWav([b.getChannelData(0), b.getChannelData(1)], b.sampleRate, 16));
    onMakeSample(id);
  };
  const el = h('div', { class: 'sample-view' },
    h('div', { class: 'field' }, h('span', null, t('Sound (one C5 note)'))),
    wrap,
    h('div', { class: 'set-inline' },
      h('button', { class: 'b tb', type: 'button', onClick: refresh }, icon('RefreshCw', 16), t('Refresh')),
      h('button', { class: 'b tb', type: 'button', onClick: make }, icon('Scissors', 16), t('Make a sample from this sound')),
    ),
    h('p', { class: 'set-note' }, t('The sound becomes a sampler channel: then you can cut it, reverse it, add fades and slices.')),
  );
  // Called when a setting of the sound changes: the preview follows after a short pause.
  let timer = null;
  el.soundChanged = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (el.isConnected) refresh(); }, 400);
  };
  return el;
}
