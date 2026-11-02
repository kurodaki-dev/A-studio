import { h, btn, icon, hint, openMenu, promptText } from './dom.js';
import { attachPointer, fitCanvas } from './pointer.js';
import { registerDrop } from './dnd.js';
import { currentTheme } from '../themes.js';
import { SB, thumb, scrollAt, drawScrollbar } from './scrollbar.js';
import { store, getPattern, patternLength, songLength, clipLength, clipValid, newId, serialize } from '../store.js';
import { autoTargets, autoLabel, targetValue, autoValue } from '../automation.js';
import { openAutomationEditor, openClipProperties, openWaveEditor, stretchClip, clipBpm, cleanClip } from './clipEditors.js';
import { renderChannels } from '../audio/engine.js';
import { encodeWav } from '../wav.js';
import { addSample } from '../samples.js';
import { tickToSec } from '../tempo.js';
import { insertTime, deleteTime } from '../arrange.js';
import { ui } from '../ui-state.js';
import { BAR, BEAT, STEP, PPQ, TRACKS, PATTERN_COLORS, clamp } from '../constants.js';
import { getSampleMeta, getBuffer, loadBuffer, waveform } from '../samples.js';
import { createChannel } from './rack.js';
import { t } from '../i18n.js';

const HEAD_W = 92;
const RULER_H = 22;
const AUDIO_COLOR = '#5d7f96';
const AUTO_COLOR = '#7a6a8c';
const SNAPS = [
  { id: 'bar', label: t('Bar'), get ticks() { return BAR; } },
  { id: 'beat', label: t('Beat'), ticks: BEAT },
  { id: 'step', label: t('Step'), ticks: STEP },
];

export function createPlaylist(engine, actions) {
  // Last tap on a pattern clip or a track name, to open the piano roll on a double tap.
  let lastClipTap = { clip: null, at: 0 };

  // Piano roll of a pattern, on its first channel with notes.
  function openPatternPiano(patternId) {
    const proj = store.project;
    if (patternId) proj.currentPattern = patternId;
    const pat = getPattern(proj, proj.currentPattern);
    const ch = proj.channels.find((c) => pat && pat.notes[c.id] && pat.notes[c.id].length) || proj.channels.find((c) => c.id === ui.prChannel) || proj.channels[0];
    if (actions && ch) actions.openPianoRoll(ch.id);
  }
  const cv = h('canvas', { class: 'cv', 'aria-label': 'Playlist' });
  // Playhead layer, redrawn alone while the song plays.
  const headCv = h('canvas', { class: 'cv cv-head', 'aria-hidden': 'true' });
  const wrap = h('div', { class: 'cvwrap' }, cv, headCv);
  let hg = null;
  let hdpr = 1;
  let headShown = false;
  const view = { px: 0.12, rowH: 40, sx: 0, sy: 0 };
  // W and H are the grid edges; the scrollbars use the strips after them.
  let W = 0;
  let H = 0;
  let CW = 0;
  let CH = 0;
  let dpr = 1;
  let g = null;
  let dropHover = null; // { track, tick, len }

  const toolDefs = [
    ['draw', 'Pencil', t('Draw')],
    ['delete', 'Eraser', t('Delete')],
    ['select', 'SquareDashed', t('Select')],
    ['slice', 'Scissors', t('Slice')],
    ['hand', 'Hand', t('Pan view')],
  ];
  const toolBtns = toolDefs.map(([id, ic, label]) => {
    const b = btn(ic, label, () => {
      ui.plTool = id;
      hint(t('Tool: ') + label);
      refresh();
    });
    b.dataset.tool = id;
    return b;
  });
  const snapBtn = h('button', { class: 'b tb snap', type: 'button', title: t('Snap'), onClick: (e) => {
    openMenu(e.currentTarget, SNAPS.map((s) => ({ label: s.label, checked: ui.plSnap === s.id, onClick: () => { ui.plSnap = s.id; refresh(); } })));
  } }, icon('Magnet', 16), h('span', { class: 'snap-label' }));
  const patLabel = h('span', { class: 'rack-info' });
  const loopBtn = btn('Repeat', t('Loop region: drag on the ruler with the Select tool'), () => toggleLoop());
  let overlay = null; // selection box
  const bar = h('div', { class: 'ptools' },
    h('div', { class: 'grp' }, h('span', { class: 'ptitle' }, 'Playlist'), patLabel),
    h('div', { class: 'grp' }, toolBtns),
    h('div', { class: 'grp' }, snapBtn),
    h('div', { class: 'grp' },
      loopBtn,
      btn('Flag', t('Add a marker at the play position'), () => addMarker()),
      btn('Activity', t('Add an automation clip'), (e) => automationMenu(e.currentTarget)),
      btn('Columns3', t('Insert or delete bars'), (e) => barsMenu(e.currentTarget)),
      btn('Copy', t('Copy selected clips'), () => copyClips()),
      btn('ClipboardPaste', t('Paste clips at the play position'), () => pasteClips()),
      btn('Trash', t('Delete selected clips'), () => deleteSelected()),
    ),
    h('div', { class: 'grp' },
      btn('ZoomOut', t('Zoom out'), () => zoomX(1 / 1.4, HEAD_W + (W - HEAD_W) / 2)),
      btn('ZoomIn', t('Zoom in'), () => zoomX(1.4, HEAD_W + (W - HEAD_W) / 2)),
    ),
  );
  const el = h('div', { class: 'panel pl' }, bar, wrap);

  function refresh() {
    toolBtns.forEach((b) => b.classList.toggle('on', b.dataset.tool === ui.plTool));
    snapBtn.querySelector('.snap-label').textContent = (SNAPS.find((s) => s.id === ui.plSnap) || SNAPS[0]).label;
    const pat = getPattern(store.project, store.project.currentPattern);
    patLabel.textContent = pat ? t('Pattern to place: ') + pat.name : '';
    loopBtn.classList.toggle('on', !!(store.project.loop && store.project.loop.on));
  }

  // Selection, clipboard, loop region and markers
  const selectedClips = () => store.project.playlist.clips.filter((c) => c.s);
  function clearClipSel() {
    for (const c of store.project.playlist.clips) delete c.s;
  }

  function copyClips() {
    const sel = selectedClips();
    if (!sel.length) return hint(t('Select clips with the Select tool first'));
    const a = Math.min(...sel.map((c) => c.start));
    ui.clipClipboard = sel.map((c) => ({ ...JSON.parse(serialize(c)), start: c.start - a }));
    hint(sel.length + t(' clip(s) copied'));
  }

  function pasteClips() {
    if (!ui.clipClipboard || !ui.clipClipboard.length) return;
    const at = Math.floor(engine.position() / snap()) * snap();
    store.change((p) => {
      clearClipSel();
      for (const c of ui.clipClipboard) p.playlist.clips.push({ ...JSON.parse(JSON.stringify(c)), id: newId('k'), start: at + c.start, s: true });
    });
  }

  function duplicateClips() {
    const sel = selectedClips();
    if (!sel.length) return;
    const a = Math.min(...sel.map((c) => c.start));
    const b = Math.max(...sel.map((c) => c.start + clipLength(store.project, c)));
    const span = Math.ceil((b - a) / BAR) * BAR || BAR;
    store.change((p) => {
      clearClipSel();
      for (const c of sel) p.playlist.clips.push({ ...JSON.parse(serialize(c)), id: newId('k'), start: c.start + span, s: true });
    });
  }

  function deleteSelected() {
    const sel = selectedClips();
    if (!sel.length) return;
    store.change((p) => { p.playlist.clips = p.playlist.clips.filter((c) => !c.s); });
    hint(sel.length + t(' clip(s) deleted'));
  }

  // Cut a clip in two at a tick. The right part keeps playing from where it was.
  function splitClip(c, at) {
    const len = clipLength(store.project, c);
    const cut = Math.round(at / snap()) * snap();
    if (cut <= c.start || cut >= c.start + len) return false;
    const right = { ...JSON.parse(serialize(c)), id: newId('k'), start: cut, len: c.start + len - cut, offset: (c.offset || 0) + (cut - c.start) };
    if (c.type === 'auto') {
      const d = cut - c.start;
      right.points = [[0, autoValue(c.points, d)], ...c.points.filter((q) => q[0] > d).map((q) => [q[0] - d, q[1]])];
      delete right.offset;
      c.points = [...c.points.filter((q) => q[0] < d), [d, autoValue(c.points, d)]];
    }
    if (c.type === 'audio' && c.fadeIn) delete right.fadeIn;
    c.len = cut - c.start;
    if (c.type === 'audio') delete c.fadeOut;
    store.project.playlist.clips.push(right);
    return true;
  }

  function toggleLoop() {
    store.change((p) => {
      if (!p.loop) p.loop = { on: false, start: 0, end: BAR * 4 };
      const sel = selectedClips();
      if (!p.loop.on && sel.length) {
        p.loop.start = Math.min(...sel.map((c) => c.start));
        p.loop.end = Math.max(...sel.map((c) => c.start + clipLength(p, c)));
      }
      p.loop.on = !p.loop.on;
    });
    const lp = store.project.loop;
    hint(lp.on ? t('Loop: bar ') + (Math.floor(lp.start / BAR) + 1) + t(' to ') + Math.ceil(lp.end / BAR) : t('Loop off'));
  }

  async function addMarker(at = engine.position()) {
    const name = await promptText(t('Marker name'), t('Marker ') + ((store.project.markers || []).length + 1));
    if (name == null) return;
    store.change((p) => {
      if (!p.markers) p.markers = [];
      p.markers.push({ id: newId('m'), t: Math.max(0, Math.floor(at / BEAT) * BEAT), name: name.slice(0, 40) });
      p.markers.sort((a, b) => a.t - b.t);
    });
  }

  function markerAt(p) {
    for (const m of store.project.markers || []) if (Math.abs(xAt(m.t) - p.x) < 8) return m;
    return null;
  }

  function markerMenu(anchorP, m) {
    const anchor = { getBoundingClientRect: () => { const r = cv.getBoundingClientRect(); return { left: r.left + anchorP.x, right: r.left + anchorP.x, top: r.top + anchorP.y, bottom: r.top + anchorP.y }; } };
    openMenu(anchor, [
      { header: m.name || t('Marker') },
      { label: t('Jump here'), icon: 'Play', onClick: () => { engine.setPosition(m.t); draw(); } },
      { label: t('Rename'), icon: 'Pencil', onClick: async () => {
        const v = await promptText(t('Marker name'), m.name);
        if (v != null) store.change(() => { m.name = v.slice(0, 40); });
      } },
      { label: Number.isFinite(m.bpm) ? t('Tempo change: ') + m.bpm + ' BPM' : t('Set a tempo change here'), icon: 'Timer', onClick: async () => {
        const v = await promptText(t('Tempo from this marker (BPM), empty for none'), Number.isFinite(m.bpm) ? String(m.bpm) : String(store.project.bpm));
        if (v == null) return;
        const n = Number(String(v).replace(',', '.'));
        store.change(() => {
          if (v.trim() === '' || !Number.isFinite(n)) delete m.bpm;
          else m.bpm = clamp(n, 10, 522);
        });
      } },
      { label: t('Delete marker'), icon: 'Trash', onClick: () => store.change((p) => { p.markers = p.markers.filter((x) => x !== m); }) },
    ]);
  }

  function barsMenu(anchor) {
    const at = Math.floor(engine.position() / BAR) * BAR;
    const bar = Math.floor(at / BAR) + 1;
    openMenu(anchor, [
      { header: t('At the play position (bar ') + bar + ')' },
      { label: t('Insert a bar'), icon: 'Plus', onClick: () => { store.change((p) => insertTime(p, at, BAR)); hint(t('Bar inserted at bar ') + bar); } },
      { label: t('Insert 4 bars'), icon: 'Plus', onClick: () => { store.change((p) => insertTime(p, at, BAR * 4)); hint(t('4 bars inserted at bar ') + bar); } },
      { label: t('Delete this bar'), icon: 'Minus', onClick: () => { store.change((p) => deleteTime(p, at, BAR)); hint(t('Bar deleted: ') + bar); } },
      { label: t('Delete 4 bars from here'), icon: 'Minus', onClick: () => { store.change((p) => deleteTime(p, at, BAR * 4)); hint(t('4 bars deleted from bar ') + bar); } },
    ]);
  }

  function automationMenu(anchor) {
    const list = autoTargets(store.project);
    const items = [{ header: t('Parameter to automate') }];
    let group = '';
    for (const a of list) {
      if (a.group !== group) {
        if (group) items.push({ sep: true });
        group = a.group;
      }
      items.push({ label: a.label, onClick: () => addAutomation(a.id) });
    }
    openMenu(anchor, items);
  }

  function addAutomation(target) {
    const p = store.project;
    let track = 0;
    for (let i = TRACKS - 1; i >= 0; i--) if (!p.playlist.clips.some((c) => c.track === i)) { track = i; break; }
    const len = Math.max(BAR * 4, songLength(p));
    const v = targetValue(p, target);
    let clip = null;
    store.change((pp) => {
      clip = { id: newId('k'), type: 'auto', target, track, start: 0, len, points: [[0, v], [len, v]] };
      pp.playlist.clips.push(clip);
    });
    hint(t('Automation clip added on ') + p.playlist.tracks[track].name);
    openAutomationEditor(clip, engine);
  }

  // Comping: copy the chosen piece of a take to the track named Comp (created on a free
  // track with the same mixer insert) and mute the take tracks.
  function sendToComp(c) {
    const p = store.project;
    let comp = p.playlist.tracks.findIndex((tr) => tr.name === 'Comp');
    if (comp < 0) {
      for (let i = 0; i < TRACKS && comp < 0; i++) if (!p.playlist.clips.some((x) => x.track === i)) comp = i;
      if (comp < 0) return hint(t('No free track for the comp'));
    }
    const len = clipLength(p, c);
    store.change((pp) => {
      const tr = pp.playlist.tracks[comp];
      tr.name = 'Comp';
      tr.mute = false;
      const ins = pp.playlist.tracks[c.track].insert;
      if (ins) tr.insert = ins;
      // Replace what the comp already has in this time range.
      pp.playlist.clips = pp.playlist.clips.filter((x) => !(x.track === comp && x.start < c.start + len && x.start + clipLength(pp, x) > c.start));
      pp.playlist.clips.push({ ...JSON.parse(serialize(c)), id: newId('k'), track: comp });
      for (const x of pp.playlist.clips) if (x.type === 'audio' && x.track !== comp && x.sampleId === c.sampleId) pp.playlist.tracks[x.track].mute = true;
    });
    hint(t('Copied to the Comp track'));
  }

  // Render a pattern clip (with its repeats, channels and mixer effects) to an audio clip.
  async function renderToAudio(c) {
    const p = store.project;
    const len = clipLength(p, c);
    hint(t('Rendering...'));
    const copy = JSON.parse(serialize(p));
    copy.playlist.clips = [{ ...JSON.parse(serialize(c)), start: 0, track: 0 }];
    copy.playlist.tracks.forEach((tr) => { tr.mute = false; });
    copy.markers = [];
    copy.loop = { on: false, start: 0, end: BAR };
    try {
      const { channels, sampleRate } = await renderChannels(copy, 'song');
      const n = Math.min(channels[0].length, Math.round(tickToSec(copy, len) * sampleRate));
      const name = clipName(c) + ' (audio)';
      const id = await addSample(name, 'Renders', encodeWav(channels.map((d) => d.slice(0, n)), sampleRate, 16));
      store.change(() => {
        delete c.patternId;
        delete c.offset;
        c.type = 'audio';
        c.sampleId = id;
        c.name = name;
        c.len = len;
      });
      hint(t('Rendered: ') + name);
    } catch (e) {
      hint(String((e && e.message) || e));
    }
  }

  // Track menu: rename, mute, and the mixer insert its audio clips play through.
  function trackMenu(p, tr) {
    const track = store.project.playlist.tracks[tr];
    const anchor = { getBoundingClientRect: () => { const r = cv.getBoundingClientRect(); return { left: r.left + p.x, right: r.left + p.x, top: r.top + p.y, bottom: r.top + p.y }; } };
    openMenu(anchor, [
      { header: track.name },
      { label: t('Rename'), icon: 'Pencil', onClick: async () => {
        const v = await promptText(t('Track name'), track.name);
        if (v) store.change(() => { track.name = v.slice(0, 40); });
      } },
      { label: track.mute ? t('Unmute') : t('Mute'), icon: 'Volume2', onClick: () => store.change(() => { track.mute = !track.mute; }) },
      { label: t('Mixer insert for audio clips') + ': ' + (track.insert ? track.insert : 'Master') + '...', icon: 'SlidersVertical', onClick: () => openMenu(anchor, [
        { header: t('Audio clips of this track play through') },
        ...store.project.mixer.map((m, i) => ({ label: i === 0 ? 'Master' : i + '  ' + m.name, checked: (track.insert || 0) === i, onClick: () => store.change(() => {
          if (i) track.insert = i;
          else delete track.insert;
        }) })),
      ]) },
    ]);
  }

  function clipMenu(p, hit) {
    const c = hit.c;
    const at = tickAt(p.x);
    const anchor = { getBoundingClientRect: () => { const r = cv.getBoundingClientRect(); return { left: r.left + p.x, right: r.left + p.x, top: r.top + p.y, bottom: r.top + p.y }; } };
    openMenu(anchor, [
      { header: clipName(c) },
      c.type === 'auto'
        ? { label: t('Edit automation'), icon: 'Activity', onClick: () => openAutomationEditor(c, engine) }
        : c.type === 'audio'
        ? { label: t('Clip properties'), icon: 'SlidersVertical', onClick: () => openClipProperties(c) }
        : { label: t('Open in the piano roll'), icon: 'Piano', onClick: () => { store.project.currentPattern = c.patternId; store.emit(); } },
      ...(c.type === 'audio' ? [
        { label: t('Edit audio') + '...', icon: 'AudioWaveform', onClick: () => openWaveEditor(c, engine) },
        { label: t('Clean up voice (one tap)'), icon: 'WandSparkles', onClick: () => cleanClip(c) },
        { label: t('Detect BPM'), icon: 'Timer', onClick: async () => {
          const bpm = await clipBpm(c);
          hint(bpm ? clipName(c) + ': ' + bpm + ' BPM' : t('No clear tempo found'));
        } },
        { label: t('Fit to the project tempo (keep pitch)') + '...', icon: 'Timer', onClick: async () => {
          const found = await clipBpm(c);
          const v = await promptText(t('Tempo of this sample (BPM)'), found ? String(found) : '');
          const src = Number(String(v || '').replace(',', '.'));
          if (!(src > 20 && src < 400)) return;
          stretchClip(c, src / store.project.bpm, Math.round(store.project.bpm) + ' BPM');
        } },
        { label: t('Change speed (keep pitch)') + '...', icon: 'Timer', onClick: async () => {
          const v = await promptText(t('Speed in percent (50 = half speed, 200 = double)'), '100');
          const pc = Number(String(v || '').replace(',', '.'));
          if (!(pc >= 25 && pc <= 400) || pc === 100) return;
          stretchClip(c, 100 / pc, pc + '%');
        } },
        { label: t('Send to the comp track'), icon: 'Layers', onClick: () => sendToComp(c) },
      ] : []),
      ...(!c.type ? [{ label: t('Render to an audio clip'), icon: 'AudioWaveform', onClick: () => renderToAudio(c) }] : []),
      { label: t('Split here'), icon: 'Scissors', onClick: () => { store.commit(); if (splitClip(c, at)) store.emit(); else store.undoStack.pop(); } },
      { label: t('Duplicate'), icon: 'CopyPlus', onClick: () => { clearClipSel(); c.s = true; duplicateClips(); } },
      { label: t('Loop this clip'), icon: 'Repeat', onClick: () => store.change((pp) => { pp.loop = { on: true, start: c.start, end: c.start + clipLength(pp, c) }; }) },
      { label: t('Delete'), icon: 'Trash', onClick: () => store.change(() => removeClip(c)) },
    ]);
  }

  const snap = () => (SNAPS.find((s) => s.id === ui.plSnap) || SNAPS[0]).ticks;
  const tickAt = (x) => (x - HEAD_W + view.sx) / view.px;
  const xAt = (t) => HEAD_W + t * view.px - view.sx;
  const trackAt = (y) => Math.floor((y - RULER_H + view.sy) / view.rowH);
  const yAt = (tr) => RULER_H + tr * view.rowH - view.sy;
  const spt = () => 60 / (store.project.bpm * PPQ);

  function clampView() {
    view.sx = Math.max(0, view.sx);
    view.sy = clamp(view.sy, 0, Math.max(0, TRACKS * view.rowH - (H - RULER_H)));
  }

  const hView = () => W - HEAD_W;
  const hTotal = () => Math.max((songLength(store.project) + 4 * BAR) * view.px, view.sx + hView());
  const vView = () => H - RULER_H;
  const vTotal = () => TRACKS * view.rowH;

  function scrollbarDown(p, st) {
    const horiz = st.region === 'hscroll';
    const th = horiz ? thumb(HEAD_W, W, hView(), hTotal(), view.sx) : thumb(RULER_H, H, vView(), vTotal(), view.sy);
    const at = horiz ? p.x : p.y;
    st.grab = at >= th.pos && at <= th.pos + th.size ? at - th.pos : th.size / 2;
    scrollbarMove(p, st);
  }

  function scrollbarMove(p, st) {
    if (st.region === 'hscroll') view.sx = scrollAt(HEAD_W, W, hView(), hTotal(), p.x - st.grab);
    else view.sy = scrollAt(RULER_H, H, vView(), vTotal(), p.y - st.grab);
    clampView();
    draw();
  }

  function clipAt(p) {
    const tr = trackAt(p.y);
    const t = tickAt(p.x);
    const proj = store.project;
    const clips = proj.playlist.clips;
    for (let i = clips.length - 1; i >= 0; i--) {
      const c = clips[i];
      if (c.track !== tr || !clipValid(proj, c)) continue;
      const len = clipLength(proj, c);
      if (t >= c.start && t < c.start + len) {
        const right = xAt(c.start + len);
        const w = len * view.px;
        return { c, edge: p.x >= right - Math.max(8, Math.min(16, w * 0.3)) };
      }
    }
    return null;
  }

  function clipName(c) {
    if (c.type === 'auto') return autoLabel(store.project, c.target);
    if (c.type === 'audio') return c.name || (getSampleMeta(c.sampleId) || {}).name || 'Sample';
    const pat = getPattern(store.project, c.patternId);
    return pat ? pat.name : '';
  }

  function drawPatternBody(c, x, y, len) {
    const pat = getPattern(store.project, c.patternId);
    const L = patternLength(pat);
    let lo = Infinity;
    let hi = -Infinity;
    for (const arr of Object.values(pat.notes)) for (const n of arr) { lo = Math.min(lo, n.key); hi = Math.max(hi, n.key); }
    const top = y + 16;
    const hh = view.rowH - 20;
    const off = c.offset || 0;
    for (let k = 0; (k * L) - off < len; k++) {
      const bx = x + (k * L - off) * view.px;
      if (k * L - off > 0) {
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(Math.round(bx), y + 2, 1, view.rowH - 4);
      }
      if (lo > hi) continue;
      const span = Math.max(12, hi - lo + 1);
      const base = (lo + hi) / 2 - span / 2;
      g.fillStyle = 'rgba(15,20,22,0.75)';
      for (const arr of Object.values(pat.notes)) {
        for (const n of arr) {
          const rel = k * L + n.t - off;
          if (n.t >= L || rel >= len || rel < 0) continue;
          const nx = bx + n.t * view.px;
          const ny = top + hh - ((n.key - base + 1) / span) * hh;
          g.fillRect(nx, ny, Math.max(1, Math.min(n.len, len - rel) * view.px - 1), Math.max(1.5, hh / span));
        }
      }
    }
  }

  function drawAudioBody(c, x, y, len) {
    const buf = getBuffer(c.sampleId);
    if (!buf) {
      if (getSampleMeta(c.sampleId)) loadBuffer(c.sampleId);
      else {
        g.fillStyle = '#f2f4f5';
        g.fillText(t('Missing sample'), x + 4, y + view.rowH - 10);
      }
      return;
    }
    const pk = waveform(c.sampleId, 400);
    const rate = Math.pow(2, (c.pitch || 0) / 12);
    const sampleW = (buf.duration / rate / spt()) * view.px;
    const offPx = (c.offset || 0) * view.px;
    const mid = y + 16 + (view.rowH - 20) / 2;
    const amp = (view.rowH - 20) / 2;
    g.fillStyle = 'rgba(15,20,22,0.75)';
    const wMax = Math.min(len * view.px, sampleW - offPx);
    const gain = c.gain == null ? 1 : c.gain;
    for (let px = 0; px < wMax; px += 1) {
      const i = Math.min(pk.length - 1, Math.floor(((px + offPx) / sampleW) * pk.length));
      const a = Math.max(0.5, Math.min(1, pk[i] * gain) * amp);
      g.fillRect(x + px, mid - a, 1, a * 2);
    }
    // Fades
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 1;
    if (c.fadeIn) {
      g.beginPath();
      g.moveTo(x, y + view.rowH - 3);
      g.lineTo(x + c.fadeIn * view.px, y + 16);
      g.stroke();
    }
    if (c.fadeOut) {
      g.beginPath();
      g.moveTo(x + (len - c.fadeOut) * view.px, y + 16);
      g.lineTo(x + len * view.px, y + view.rowH - 3);
      g.stroke();
    }
  }

  function drawAutoBody(c, x, y, len) {
    const top = y + 16;
    const hh = view.rowH - 20;
    g.strokeStyle = '#f2f4f5';
    g.lineWidth = 1.5;
    g.beginPath();
    const n = Math.max(2, Math.min(400, Math.ceil(len * view.px / 3)));
    for (let i = 0; i <= n; i++) {
      const tk = (len * i) / n;
      const vy = top + hh - autoValue(c.points, tk) * hh;
      if (i === 0) g.moveTo(x + tk * view.px, vy);
      else g.lineTo(x + tk * view.px, vy);
    }
    g.stroke();
    g.fillStyle = '#f2f4f5';
    for (const [tk, v] of c.points) if (tk <= len) g.fillRect(x + tk * view.px - 2, top + hh - v * hh - 2, 4, 4);
  }

  function drawHead() {
    if (!hg) return;
    hg.setTransform(hdpr, 0, 0, hdpr, 0, 0);
    hg.clearRect(0, 0, CW, CH);
    if (!ui.songMode || !(engine.playing || engine.pos > 0)) return;
    const x = Math.round(xAt(engine.heardPosition()));
    if (x < HEAD_W || x > W) return;
    hg.fillStyle = currentTheme().editor.playhead;
    hg.fillRect(x, RULER_H, 1, H - RULER_H);
    hg.beginPath();
    hg.moveTo(x - 5, RULER_H - 8);
    hg.lineTo(x + 5, RULER_H - 8);
    hg.lineTo(x, RULER_H - 1);
    hg.closePath();
    hg.fill();
  }

  function draw() {
    drawMain();
    drawHead();
  }

  function drawMain() {
    if (!g) return;
    const p = store.project;
    const th = currentTheme();
    const E = th.editor;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = th.colors.panel;
    g.fillRect(0, 0, W, H);
    const t0 = Math.max(0, tickAt(HEAD_W));
    const t1 = tickAt(W);
    g.save();
    g.beginPath();
    g.rect(HEAD_W, RULER_H, W - HEAD_W, H - RULER_H);
    g.clip();
    for (let tr = 0; tr < TRACKS; tr++) {
      const y = yAt(tr);
      if (y > H || y + view.rowH < RULER_H) continue;
      g.fillStyle = tr % 2 ? E.trackB : E.trackA;
      g.fillRect(HEAD_W, y, W - HEAD_W, view.rowH);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(HEAD_W, y + view.rowH - 1, W - HEAD_W, 1);
    }
    const beatPx = BEAT * view.px;
    const inc = beatPx >= 8 ? BEAT : BAR;
    for (let t = Math.floor(t0 / inc) * inc; t <= t1; t += inc) {
      g.fillStyle = t % BAR === 0 ? '#161c1f' : 'rgba(0,0,0,0.25)';
      g.fillRect(Math.round(xAt(t)), RULER_H, 1, H - RULER_H);
    }
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (const c of p.playlist.clips) {
      if (!clipValid(p, c)) continue;
      const len = clipLength(p, c);
      const x = xAt(c.start);
      const w = len * view.px;
      const y = yAt(c.track);
      if (x > W || x + w < HEAD_W || y > H || y + view.rowH < RULER_H) continue;
      const muted = p.playlist.tracks[c.track] && p.playlist.tracks[c.track].mute;
      const col = c.type === 'audio' ? AUDIO_COLOR : c.type === 'auto' ? AUTO_COLOR : PATTERN_COLORS[getPattern(p, c.patternId).color % PATTERN_COLORS.length];
      g.globalAlpha = muted ? 0.4 : 1;
      g.fillStyle = '#1a2023';
      g.fillRect(x, y + 1, w, view.rowH - 2);
      g.fillStyle = col;
      g.fillRect(x + 1, y + 2, w - 2, view.rowH - 4);
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(x + 1, y + 2, w - 2, 13);
      g.save();
      g.beginPath();
      g.rect(x + 1, y + 2, Math.max(0, w - 2), view.rowH - 4);
      g.clip();
      g.fillStyle = '#f2f4f5';
      g.fillText(clipName(c), x + 4, y + 9);
      if (c.type === 'audio') drawAudioBody(c, x, y, len);
      else if (c.type === 'auto') drawAutoBody(c, x, y, len);
      else drawPatternBody(c, x, y, len);
      g.restore();
      if (c.s) {
        g.strokeStyle = '#f18b80';
        g.lineWidth = 2;
        g.strokeRect(x + 1, y + 2, Math.max(2, w - 2), view.rowH - 4);
      }
      // Stretch handle on the right edge
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(Math.round(x + w) - 4, y + view.rowH / 2 - 6, 2, 12);
      g.globalAlpha = 1;
    }
    if (dropHover) {
      const y = yAt(dropHover.track);
      const x = xAt(dropHover.tick);
      g.fillStyle = 'rgba(240,153,58,0.18)';
      g.fillRect(HEAD_W, y, W - HEAD_W, view.rowH);
      g.strokeStyle = '#f0993a';
      g.lineWidth = 2;
      g.strokeRect(x + 1, y + 2, Math.max(8, dropHover.len * view.px) - 2, view.rowH - 4);
    }
    const lp = p.loop;
    if (lp && lp.on) {
      g.fillStyle = 'rgba(240,153,58,0.07)';
      g.fillRect(xAt(lp.start), RULER_H, (lp.end - lp.start) * view.px, H - RULER_H);
    }
    for (const m of p.markers || []) {
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(Math.round(xAt(m.t)), RULER_H, 1, H - RULER_H);
    }
    if (overlay) {
      g.fillStyle = 'rgba(241,139,128,0.12)';
      g.strokeStyle = '#f18b80';
      g.lineWidth = 1;
      g.fillRect(overlay.x, overlay.y, overlay.w, overlay.h);
      g.strokeRect(overlay.x + 0.5, overlay.y + 0.5, overlay.w, overlay.h);
    }
    g.restore();

    // Ruler
    g.fillStyle = E.ruler;
    g.fillRect(0, 0, W, RULER_H);
    g.save();
    g.beginPath();
    g.rect(HEAD_W, 0, W - HEAD_W, RULER_H);
    g.clip();
    const barPx = BAR * view.px;
    const every = barPx < 26 ? Math.ceil(26 / barPx) : 1;
    for (let b = Math.floor(t0 / BAR); b * BAR < t1; b++) {
      const x = Math.round(xAt(b * BAR));
      g.fillStyle = '#5d6a70';
      g.fillRect(x, 10, 1, RULER_H - 10);
      if (b % every === 0) {
        g.fillStyle = th.colors.dim;
        g.fillText(String(b + 1), x + 4, 9);
      }
    }
    const end = songLength(p);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(Math.max(HEAD_W, xAt(end)), 0, W, RULER_H);
    if (lp && (lp.on || ui.plTool === 'select')) {
      g.fillStyle = lp.on ? '#f0993a' : 'rgba(240,153,58,0.35)';
      g.fillRect(xAt(lp.start), 0, (lp.end - lp.start) * view.px, 4);
    }
    for (const m of p.markers || []) {
      const mx = Math.round(xAt(m.t));
      g.fillStyle = Number.isFinite(m.bpm) ? '#e8c35a' : '#cfd8dc';
      g.beginPath();
      g.moveTo(mx, 4);
      g.lineTo(mx + 6, 8);
      g.lineTo(mx, 12);
      g.closePath();
      g.fill();
      const label = (m.name || '') + (Number.isFinite(m.bpm) ? ' ' + m.bpm + ' BPM' : '');
      g.fillStyle = E.ruler;
      g.fillRect(mx + 7, 2, g.measureText(label).width + 4, 13);
      g.fillStyle = th.colors.text;
      g.fillText(label, mx + 9, 9);
    }
    g.restore();
    g.fillStyle = '#151a1d';
    g.fillRect(0, RULER_H - 1, W, 1);

    // Track headers
    g.save();
    g.beginPath();
    g.rect(0, RULER_H, HEAD_W, H - RULER_H);
    g.clip();
    for (let tr = 0; tr < TRACKS; tr++) {
      const y = yAt(tr);
      if (y > H || y + view.rowH < RULER_H) continue;
      const t = p.playlist.tracks[tr];
      g.fillStyle = th.colors.panel2;
      g.fillRect(0, y, HEAD_W, view.rowH);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, y + view.rowH - 1, HEAD_W, 1);
      g.fillStyle = t.mute ? th.colors.panel3 : th.colors.green;
      g.fillRect(8, y + view.rowH / 2 - 5, 10, 10);
      g.fillStyle = t.mute ? th.colors.dim : th.colors.text;
      g.fillText(t.name, 26, y + view.rowH / 2 - (t.insert ? 6 : 0));
      if (t.insert) {
        g.fillStyle = th.colors.dim;
        g.fillText('→ ' + t.insert + ' ' + p.mixer[t.insert].name, 26, y + view.rowH / 2 + 8);
      }
    }
    g.restore();
    g.fillStyle = '#151a1d';
    g.fillRect(HEAD_W - 1, RULER_H, 1, H - RULER_H);
    g.fillStyle = E.ruler;
    g.fillRect(0, 0, HEAD_W, RULER_H);

    const sbc = { track: th.colors.input, thumb: th.colors.dim };
    drawScrollbar(g, true, HEAD_W, H, W - HEAD_W, SB, hView(), hTotal(), view.sx, sbc);
    drawScrollbar(g, false, W, RULER_H, H - RULER_H, SB, vView(), vTotal(), view.sy, sbc);
    g.fillStyle = th.colors.panel2;
    g.fillRect(0, H, HEAD_W, CH - H);
    g.fillRect(W, 0, CW - W, RULER_H);
    g.fillRect(W, H, CW - W, CH - H);
  }

  function placeClip(p) {
    const proj = store.project;
    const tr = trackAt(p.y);
    if (tr < 0 || tr >= TRACKS) return null;
    const clip = { id: newId('k'), patternId: proj.currentPattern, track: tr, start: Math.max(0, Math.floor(tickAt(p.x) / snap()) * snap()) };
    proj.playlist.clips.push(clip);
    return clip;
  }

  function removeClip(c) {
    const arr = store.project.playlist.clips;
    const i = arr.indexOf(c);
    if (i >= 0) arr.splice(i, 1);
  }

  function regionAt(p) {
    if (p.y >= H) return p.x >= HEAD_W && p.x < W ? 'hscroll' : 'corner';
    if (p.x >= W) return p.y >= RULER_H ? 'vscroll' : 'corner';
    if (p.y < RULER_H) return p.x < HEAD_W ? 'corner' : 'ruler';
    if (p.x < HEAD_W) return 'head';
    return 'grid';
  }

  function fmtLen(tk) {
    if (tk % BAR === 0) return tk / BAR + (tk / BAR > 1 ? t(' bars') : t(' bar'));
    if (tk % BEAT === 0) return tk / BEAT + t(' beats');
    return Math.round(tk / STEP) + t(' steps');
  }

  attachPointer(cv, {
    down(p, st) {
      st.region = regionAt(p);
      if (st.region === 'hscroll' || st.region === 'vscroll') return scrollbarDown(p, st);
      if (st.region === 'ruler') {
        st.marker = markerAt(p);
        if (ui.plTool === 'select') st.loopDrag = true;
        else if (!st.marker) seek(p);
        return;
      }
      if (st.region === 'grid' && (ui.plTool === 'delete' || st.button === 2)) {
        store.commit();
        st.committed = true;
        st.erasing = true;
        const hit = clipAt(p);
        if (hit) {
          removeClip(hit.c);
          store.emit();
        }
      }
    },
    tap(p, st) {
      if (st.region === 'ruler') {
        if (st.marker) markerMenu(p, st.marker);
        else if (st.loopDrag) seek(p, true);
        return;
      }
      if (st.region === 'head') {
        const tr = trackAt(p.y);
        const t = store.project.playlist.tracks[tr];
        // Double tap on a track name: piano roll of the first pattern on that track
        // (the mute toggled by the first tap is put back).
        const now = performance.now();
        if (lastClipTap.clip === 'track' + tr && now - lastClipTap.at < 450) {
          lastClipTap = { clip: null, at: 0 };
          if (t) store.change(() => { t.mute = !t.mute; });
          const first = store.project.playlist.clips.filter((c) => c.track === tr && c.patternId && !c.type).sort((a, b) => a.start - b.start)[0];
          openPatternPiano(first && first.patternId);
          return;
        }
        lastClipTap = { clip: 'track' + tr, at: now };
        if (t) store.change(() => { t.mute = !t.mute; });
        return;
      }
      if (st.region !== 'grid' || st.erasing) return;
      if (ui.plTool === 'select') {
        const hit = clipAt(p);
        if (hit) hit.c.s = !hit.c.s;
        else clearClipSel();
        store.emit();
        return;
      }
      if (ui.plTool === 'slice') {
        const hit = clipAt(p);
        if (!hit) return;
        store.commit();
        if (splitClip(hit.c, tickAt(p.x))) store.emit();
        else store.undoStack.pop();
        return;
      }
      if (ui.plTool !== 'draw') return;
      const hit = clipAt(p);
      if (hit && hit.c.type === 'auto') {
        openAutomationEditor(hit.c, engine);
      } else if (hit && hit.c.type === 'audio') {
        engine.previewSample(hit.c.sampleId);
      } else if (hit) {
        // Double tap on a pattern clip: its piano roll, on the first channel with notes.
        const now = performance.now();
        if (lastClipTap.clip === hit.c && now - lastClipTap.at < 450) {
          lastClipTap = { clip: null, at: 0 };
          openPatternPiano(hit.c.patternId);
          return;
        }
        lastClipTap = { clip: hit.c, at: now };
        store.project.currentPattern = hit.c.patternId;
        hint(t('Selected pattern: ') + getPattern(store.project, hit.c.patternId).name);
        store.emit();
      } else {
        store.commit();
        if (!placeClip(p)) store.undoStack.pop();
        store.emit();
      }
    },
    dragStart(p0, p, st) {
      if (st.region === 'ruler' && st.loopDrag) {
        store.commit();
        st.committed = true;
        st.mode = 'loop';
        st.loopA = Math.max(0, Math.round(tickAt(p0.x) / snap()) * snap());
        return;
      }
      if (st.region !== 'grid' || st.erasing) return;
      if (ui.plTool === 'hand') {
        st.mode = 'pan';
        return;
      }
      if (ui.plTool === 'select') {
        const hit = clipAt(p0);
        if (hit && hit.c.s) {
          store.commit();
          st.committed = true;
          st.mode = 'moveSel';
          st.moving = selectedClips().map((c) => ({ c, start: c.start, track: c.track }));
        } else {
          st.mode = 'box';
          if (!st.button || st.button === 0) clearClipSel();
        }
        return;
      }
      if (ui.plTool !== 'draw') return;
      store.commit();
      st.committed = true;
      const hit = clipAt(p0);
      if (hit && hit.edge) {
        st.mode = 'resize';
        st.clip = hit.c;
        st.len0 = clipLength(store.project, hit.c);
        return;
      }
      const c = hit ? hit.c : placeClip(p0);
      if (!c) return;
      st.mode = 'move';
      st.clip = c;
      st.start0 = c.start;
      st.track0 = c.track;
      store.emit();
    },
    dragMove(p, st) {
      if (st.region === 'hscroll' || st.region === 'vscroll') return scrollbarMove(p, st);
      if (st.mode === 'loop') {
        const b = Math.max(0, Math.round(tickAt(p.x) / snap()) * snap());
        const lp = store.project.loop || (store.project.loop = { on: true, start: 0, end: BAR });
        lp.start = Math.min(st.loopA, b);
        lp.end = Math.max(st.loopA, b, lp.start + snap());
        lp.on = true;
        hint(t('Loop: bar ') + (Math.floor(lp.start / BAR) + 1) + t(' to ') + Math.ceil(lp.end / BAR));
        store.emit();
        return;
      }
      if (st.region === 'ruler') {
        if (!st.marker) seek(p);
        return;
      }
      if (st.mode === 'box') {
        overlay = { x: Math.min(st.p0.x, p.x), y: Math.min(st.p0.y, p.y), w: Math.abs(p.x - st.p0.x), h: Math.abs(p.y - st.p0.y) };
        const ta = tickAt(overlay.x);
        const tb = tickAt(overlay.x + overlay.w);
        const ra = trackAt(overlay.y);
        const rb = trackAt(overlay.y + overlay.h);
        for (const c of store.project.playlist.clips) {
          if (!clipValid(store.project, c)) continue;
          const e = c.start + clipLength(store.project, c);
          if (c.track >= ra && c.track <= rb && c.start < tb && e > ta) c.s = true;
          else delete c.s;
        }
        draw();
        return;
      }
      if (st.mode === 'moveSel') {
        const dt = Math.round((tickAt(p.x) - tickAt(st.p0.x)) / snap()) * snap();
        let dtr = trackAt(p.y) - trackAt(st.p0.y);
        const minTr = Math.min(...st.moving.map((m) => m.track));
        const maxTr = Math.max(...st.moving.map((m) => m.track));
        dtr = clamp(dtr, -minTr, TRACKS - 1 - maxTr);
        const minStart = Math.min(...st.moving.map((m) => m.start));
        const d = Math.max(-minStart, dt);
        for (const m of st.moving) {
          m.c.start = m.start + d;
          m.c.track = m.track + dtr;
        }
        store.emit();
        return;
      }
      if (st.erasing) {
        const hit = clipAt(p);
        if (hit) {
          removeClip(hit.c);
          store.emit();
        }
        return;
      }
      if (st.mode === 'pan') {
        view.sx -= p.x - st.last.x;
        view.sy -= p.y - st.last.y;
        clampView();
        draw();
      } else if (st.mode === 'move') {
        const dt = tickAt(p.x) - tickAt(st.p0.x);
        st.clip.start = Math.max(0, Math.round((st.start0 + dt) / snap()) * snap());
        st.clip.track = clamp(st.track0 + trackAt(p.y) - trackAt(st.p0.y), 0, TRACKS - 1);
        store.emit();
      } else if (st.mode === 'resize') {
        const end = st.clip.start + st.len0 + (tickAt(p.x) - tickAt(st.p0.x));
        const len = Math.max(snap(), Math.round((end - st.clip.start) / snap()) * snap());
        st.clip.len = len;
        hint(t('Clip length: ') + fmtLen(len));
        store.emit();
      }
    },
    dragEnd(p, st) {
      if (st.mode === 'box') {
        overlay = null;
        const n = selectedClips().length;
        if (n) hint(n + t(' clip(s) selected'));
        store.emit();
      }
    },
    longPress(p, st) {
      if (st.region === 'head') {
        const tr = trackAt(p.y);
        if (tr >= 0 && tr < TRACKS) trackMenu(p, tr);
        return;
      }
      if (st.region === 'ruler') {
        addMarker(Math.max(0, tickAt(p.x)));
        return;
      }
      if (st.region !== 'grid') return;
      const hit = clipAt(p);
      if (hit) {
        st.cancelled = true;
        clipMenu(p, hit);
      }
    },
    cancel(st) {
      if (st.committed) store.revert();
    },
    gesture(gs) {
      if (gs.axis === 'x') zoomX(gs.sx, gs.cx, true);
      else {
        const f = (gs.cy - RULER_H + view.sy) / view.rowH;
        view.rowH = clamp(view.rowH * gs.sy, 24, 90);
        view.sy = f * view.rowH - (gs.cy - RULER_H);
      }
      view.sx -= gs.dcx;
      view.sy -= gs.dcy;
      clampView();
      draw();
    },
    wheel(e, p) {
      if (e.ctrlKey) zoomX(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x);
      else if (e.shiftKey) view.sx += e.deltaY;
      else {
        view.sy += e.deltaY;
        view.sx += e.deltaX;
      }
      clampView();
      draw();
    },
  });

  // Drop from the browser: a sample becomes an audio clip, an instrument a new channel.
  function dropSpot(item, p) {
    const tr = trackAt(p.y);
    if (p.x < HEAD_W || p.y < RULER_H || p.x >= W || p.y >= H || tr < 0 || tr >= TRACKS) return null;
    const tick = Math.max(0, Math.floor(tickAt(p.x) / snap()) * snap());
    let len = BAR;
    if (item.kind === 'sample') {
      const m = getSampleMeta(item.id);
      if (m && m.duration) len = Math.max(STEP, Math.round(m.duration / spt()));
    }
    return { track: tr, tick, len };
  }

  registerDrop({
    el: cv,
    accepts: (item) => item.kind === 'sample' || item.kind === 'instrument',
    over(item, p) {
      dropHover = item.kind === 'sample' ? dropSpot(item, p) : null;
      draw();
    },
    leave() {
      dropHover = null;
      draw();
    },
    drop(item, p) {
      dropHover = null;
      if (item.kind === 'instrument') {
        store.change((proj) => createChannel(proj, item.id));
        hint(item.name + t(' added to the rack'));
        return;
      }
      const spot = dropSpot(item, p);
      if (!spot) return draw();
      store.change((proj) => {
        proj.playlist.clips.push({ id: newId('k'), type: 'audio', sampleId: item.id, name: item.name, track: spot.track, start: spot.tick, len: spot.len });
      });
      loadBuffer(item.id);
      hint(item.name + t(' placed on ') + store.project.playlist.tracks[spot.track].name);
    },
  });

  function zoomX(f, cx, noDraw) {
    const t = tickAt(cx);
    view.px = clamp(view.px * f, 0.01, 1.5);
    view.sx = t * view.px - (cx - HEAD_W);
    clampView();
    if (!noDraw) draw();
  }

  function seek(p, force) {
    if (!ui.songMode && !force) return;
    engine.setPosition(Math.max(0, Math.floor(tickAt(p.x) / BEAT) * BEAT));
    draw();
  }

  fitCanvas(headCv, (w, hh, r) => {
    hdpr = r;
    hg = headCv.getContext('2d');
    drawHead();
  });
  fitCanvas(cv, (w, hh, r) => {
    CW = w;
    CH = hh;
    W = w - SB;
    H = hh - SB;
    dpr = r;
    g = cv.getContext('2d');
    clampView();
    draw();
  });

  refresh();
  return {
    el,
    update() {
      refresh();
      draw();
    },
    frame() {
      if ((engine.playing && ui.songMode) || headShown) drawHead();
      headShown = engine.playing && ui.songMode;
    },
    keydown(e) {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
      else if (mod && k === 'c') copyClips();
      else if (mod && k === 'v') pasteClips();
      else if (mod && k === 'b') duplicateClips();
      else if (mod && k === 'a') {
        for (const c of store.project.playlist.clips) c.s = true;
        store.emit();
      } else return false;
      e.preventDefault();
      return true;
    },
  };
}

