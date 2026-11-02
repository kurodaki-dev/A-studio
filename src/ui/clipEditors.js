import { h, icon, openModal, dropdown, hint, openMenu } from './dom.js';
import { attachPointer, fitCanvas } from './pointer.js';
import { store, clipLength } from '../store.js';
import { BAR, BEAT, STEP, clamp } from '../constants.js';
import { autoLabel, autoValue, formatTarget } from '../automation.js';
import { currentTheme } from '../themes.js';
import { getBuffer, loadBuffer, addSample } from '../samples.js';
import { EDITS, timeStretch, detectBpm } from '../audiotools.js';
import { reduceNoise, removeHum, removeRumble, removeDC, reduceBreaths, normalizeLoudness, centerMask, toMono, cleanVoice } from '../cleanup.js';
import { encodeWav } from '../wav.js';
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
    info.textContent = t('Bar ') + (Math.floor(tk / BAR) + 1) + ', ' + formatTarget(clip.target, v, store.project);
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
  const normalize = async () => {
    const buf = getBuffer(clip.sampleId) || (await loadBuffer(clip.sampleId));
    if (!buf) return hint(t('Sample missing on this device'));
    let peak = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i += 2) peak = Math.max(peak, Math.abs(d[i]));
    }
    if (peak < 1e-4) return hint(t('The clip is silent'));
    // Playback applies 0.8 to clips: aim for a 0.95 peak.
    set(() => { clip.gain = clamp(0.95 / (0.8 * peak), 0, 2); });
    hint(t('Gain: ') + (20 * Math.log10(clip.gain)).toFixed(1) + ' dB');
    m.close();
    openClipProperties(clip);
  };
  const m = openModal({
    title: t('Clip properties'),
    body: h('div', { class: 'form' },
      h('div', { class: 'set-inline' },
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!clip.reverse, onChange: (e) => set(() => { if (e.target.checked) clip.reverse = true; else delete clip.reverse; }) }), h('span', null, t('Reverse'))),
        h('button', { class: 'b tb', type: 'button', onClick: normalize }, t('Normalize')),
      ),
      range(t('Gain'), 0, 2, 0.01, clip.gain == null ? 1 : clip.gain, (v) => (v <= 0 ? '-inf dB' : (20 * Math.log10(v)).toFixed(1) + ' dB'), (v) => set(() => { clip.gain = v; })),
      range(t('Pitch'), -24, 24, 1, clip.pitch || 0, (v) => (v > 0 ? '+' : '') + v + t(' semitones'), (v) => set(() => { clip.pitch = v; })),
      range(t('Fade in'), 0, Math.min(len, BAR * 4), STEP, clip.fadeIn || 0, steps, (v) => set(() => { clip.fadeIn = v; })),
      range(t('Fade out'), 0, Math.min(len, BAR * 4), STEP, clip.fadeOut || 0, steps, (v) => set(() => { clip.fadeOut = v; })),
      range(t('Start offset'), 0, BAR * 8, STEP, clip.offset || 0, steps, (v) => set(() => { clip.offset = v; })),
      h('p', { class: 'set-note' }, t('Pitch resamples the clip: it also changes its speed, like the resample mode in FL Studio.')),
    ),
  });
}

// Waveform editor of an audio clip. Edits work on a copy; Save stores the result
// as a new sample (the original stays in the browser) and points the clip to it.
export function openWaveEditor(clip, engine) {
  (async () => {
    const buf = getBuffer(clip.sampleId) || (await loadBuffer(clip.sampleId));
    if (!buf) return hint(t('Sample missing on this device'));
    const sr = buf.sampleRate;
    let chs = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).slice());
    const history = [];
    let sel = null; // [a, b] in samples
    const cv = h('canvas', { class: 'cv' });
    const wrap = h('div', { class: 'wave-wrap' }, cv);
    const info = h('span', { class: 'rack-info' });
    let W = 0;
    let H = 0;
    let dpr = 1;
    let g = null;
    const len = () => chs[0].length;
    const sAt = (x) => clamp(Math.round((x / W) * len()), 0, len());
    function draw() {
      if (!g) return;
      const th = currentTheme();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = th.colors.input;
      g.fillRect(0, 0, W, H);
      if (sel) {
        g.fillStyle = 'rgba(240,153,58,0.25)';
        g.fillRect((sel[0] / len()) * W, 0, ((sel[1] - sel[0]) / len()) * W, H);
      }
      g.fillStyle = th.editor.note;
      const d = chs[0];
      const step = Math.max(1, Math.floor(d.length / W));
      for (let x = 0; x < W; x++) {
        let m = 0;
        const s0 = Math.floor((x / W) * d.length);
        for (let i = s0; i < s0 + step && i < d.length; i += 2) m = Math.max(m, Math.abs(d[i]));
        g.fillRect(x, H / 2 - m * H * 0.48, 1, Math.max(1, m * H * 0.96));
      }
      const secs = (n) => (n / sr).toFixed(2) + ' s';
      info.textContent = secs(len()) + (sel ? ', ' + t('selection ') + secs(sel[0]) + ' to ' + secs(sel[1]) : ', ' + t('drag to select'));
    }
    attachPointer(cv, {
      down(p, st) { st.a = sAt(p.x); },
      tap() { sel = null; draw(); },
      dragMove(p, st) { const b = sAt(p.x); sel = [Math.min(st.a, b), Math.max(st.a, b)]; draw(); },
    });
    fitCanvas(cv, (w, hh, r) => { W = w; H = hh; dpr = r; g = cv.getContext('2d'); draw(); });
    const op = (name, ...args) => () => {
      const [a, b] = sel || [0, len()];
      if (b - a < 2) return;
      history.push(chs);
      chs = EDITS[name](chs, a, b, ...args);
      if (name === 'cut' || name === 'trim') sel = null;
      draw();
    };
    const b = (label, fn) => h('button', { class: 'b tb', type: 'button', onClick: fn }, label);
    // Clean up tools: they work on the whole sample; for noise reduction the selection,
    // when there is one, is the noise to learn (a part with only the background noise).
    const clean = (label, fn) => async () => {
      hint(t('Processing...'));
      await new Promise((r) => setTimeout(r, 20));
      history.push(chs);
      const res = fn(chs);
      chs = Array.isArray(res) ? res : res.channels;
      draw();
      hint(label + (res.base ? ': ' + res.base + ' Hz' : '') + (Number.isFinite(res.gainDb) ? ': ' + (res.gainDb > 0 ? '+' : '') + res.gainDb.toFixed(1) + ' dB' : ''));
    };
    const noise = (db) => clean(t('Noise reduced'), (c) => reduceNoise(c, sr, sel, db));
    const cleanMenu = (e) => openMenu(e.currentTarget, [
      { header: sel ? t('The selection is used as the noise to remove') : t('Select a part with only noise for a better result') },
      { label: t('Reduce noise: light'), icon: 'Wind', onClick: noise(6) },
      { label: t('Reduce noise: medium'), icon: 'Wind', onClick: noise(12) },
      { label: t('Reduce noise: strong'), icon: 'Wind', onClick: noise(20) },
      { label: t('Remove hum (50 or 60 Hz)'), icon: 'Activity', onClick: clean(t('Hum removed'), (c) => removeHum(c, sr)) },
      { label: t('Remove rumble and plosives (under 80 Hz)'), icon: 'AudioWaveform', onClick: clean(t('Rumble removed'), (c) => removeRumble(c, sr, 80)) },
      { label: t('Remove DC offset'), icon: 'Minus', onClick: clean(t('DC offset removed'), (c) => removeDC(c)) },
      { label: t('Reduce breaths and noise between phrases'), icon: 'Wind', onClick: clean(t('Breaths reduced'), (c) => reduceBreaths(c, sr, 30, 12)) },
      { sep: true },
      { label: t('Normalize to -14 LUFS'), icon: 'SlidersVertical', onClick: clean(t('Loudness'), (c) => normalizeLoudness(c, sr, -14)) },
      { label: t('Remove the vocals (karaoke)'), icon: 'Mic', disabled: chs.length < 2, onClick: clean(t('Vocals removed'), (c) => centerMask(c, false, sr)) },
      { label: t('Keep only the vocals (centre)'), icon: 'Mic', disabled: chs.length < 2, onClick: clean(t('Vocals isolated'), (c) => centerMask(c, true, sr)) },
      { label: t('Mono'), icon: 'Circle', onClick: clean(t('Mono'), (c) => toMono(c)) },
      { sep: true },
      { label: t('Clean up voice (all in one)'), icon: 'WandSparkles', onClick: clean(t('Voice cleaned up'), (c) => cleanVoice(c, sr)) },
    ]);
    const play = async () => {
      engine.init();
      const ab = engine.ctx.createBuffer(chs.length, len(), sr);
      chs.forEach((c, i) => ab.copyToChannel(c, i));
      const [a, z] = sel || [0, len()];
      const s = engine.ctx.createBufferSource();
      s.buffer = ab;
      s.connect(engine.ctx.destination);
      s.start(0, a / sr, (z - a) / sr);
    };
    const save = async () => {
      const bytes = encodeWav(chs, sr, 16);
      const name = (clip.name || 'Sample').replace(/ \(edit\)$/, '') + ' (edit)';
      const id = await addSample(name, 'Edits', bytes);
      const rate = Math.pow(2, (clip.pitch || 0) / 12);
      const spt = 60 / (store.project.bpm * 96);
      store.change(() => {
        clip.sampleId = id;
        clip.name = name;
        clip.len = Math.max(1, Math.round(len() / sr / rate / spt));
        delete clip.offset;
      });
      hint(t('Saved as a new sample: ') + name);
      m.close();
    };
    const m = openModal({
      title: t('Edit audio: ') + (clip.name || ''),
      wide: true,
      body: h('div', { class: 'auto-ed' },
        h('div', { class: 'set-inline' }, info),
        wrap,
        h('div', { class: 'set-actions' },
          b(t('Play'), play), b(t('Cut'), op('cut')), b(t('Trim to selection'), op('trim')), b(t('Silence'), op('silence')),
          b('+3 dB', op('gain', 3)), b('-3 dB', op('gain', -3)), b(t('Fade in'), op('fadeIn')), b(t('Fade out'), op('fadeOut')),
          b(t('Reverse'), op('reverse')), b(t('Normalize'), op('normalize')),
          h('button', { class: 'b tb primary', type: 'button', onClick: cleanMenu }, icon('WandSparkles', 16), t('Clean up')),
          b(t('Undo'), () => { if (history.length) { chs = history.pop(); draw(); } }),
        ),
        h('p', { class: 'set-note' }, t('Without a selection, an edit applies to the whole sample. Save keeps the original sample in the browser.')),
      ),
      actions: [{ label: t('Cancel') }, { label: t('Save'), primary: true, onClick: () => { save(); return false; } }],
    });
  })();
}

// Time stretch of an audio clip to a new tempo, keeping the pitch. Stored as a new sample.
export async function stretchClip(clip, factor, label) {
  const buf = getBuffer(clip.sampleId) || (await loadBuffer(clip.sampleId));
  if (!buf) return hint(t('Sample missing on this device'));
  const m = openModal({ title: t('Time stretch'), body: h('p', null, t('Processing...')), actions: [] });
  await new Promise((r) => setTimeout(r, 30));
  const chs = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const out = timeStretch(chs, buf.sampleRate, factor);
  const name = (clip.name || 'Sample') + ' (' + label + ')';
  const id = await addSample(name, 'Edits', encodeWav(out, buf.sampleRate, 16));
  store.change(() => {
    clip.sampleId = id;
    clip.name = name;
    clip.len = Math.max(1, Math.round((clip.len || 1) * factor));
    if (clip.offset) clip.offset = Math.round(clip.offset * factor);
  });
  m.close();
  hint(t('Stretched: ') + name);
}

// One tap voice clean up of a clip (DC, rumble, noise, breaths, -14 LUFS), saved as a new sample.
export async function cleanClip(clip) {
  const buf = getBuffer(clip.sampleId) || (await loadBuffer(clip.sampleId));
  if (!buf) return hint(t('Sample missing on this device'));
  const m = openModal({ title: t('Clean up voice'), body: h('p', null, t('Processing...')), actions: [] });
  await new Promise((r) => setTimeout(r, 30));
  const chs = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const out = cleanVoice(chs, buf.sampleRate);
  const name = (clip.name || 'Sample').replace(/ \(clean\)$/, '') + ' (clean)';
  const id = await addSample(name, 'Edits', encodeWav(out, buf.sampleRate, 16));
  store.change(() => {
    clip.sampleId = id;
    clip.name = name;
  });
  m.close();
  hint(t('Voice cleaned up: ') + name);
}

export async function clipBpm(clip) {
  const buf = getBuffer(clip.sampleId) || (await loadBuffer(clip.sampleId));
  if (!buf) return 0;
  return detectBpm(buf.getChannelData(0), buf.sampleRate);
}
