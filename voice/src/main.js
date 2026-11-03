// A Voice Studio: vocal synthesis extension of A Studio (DiffSinger, UTAU / OpenUTAU,
// VOICEVOX and a built-in vocoder voice), with its own interface, themes and plugins.
import './style.css';
import { h, icon, iconBtn, textBtn, hint, setHintEl, openMenu, closeMenu, openModal, alertBox, confirmBox, promptText, pickFiles, select } from './ui/dom.js';
import { store, newProject, makeTrack, makeNote, normalizeProject, serialize, PPQ, TRACK_COLORS, ticksToSec } from './store.js';
import { lyricsForNotes, normalizeLyric } from './lyrics.js';
import { createEditor, ui } from './ui/editor.js';
import { createLane } from './ui/lane.js';
import { createBrowser } from './ui/browser.js';
import { createInspector } from './ui/inspector.js';
import { renderProject, mixdown, Player, clearCache, settings, trackPhrases } from './render.js';
import { encodeWav } from './dsp.js';
import { kv, listVoices } from './voices/library.js';
import { loadThemes } from './themes.js';
import { loadPlugins, runPlugin, installPlugin, pluginInfo } from './plugins.js';
import { parseUst, parseMidi } from './formats.js';
import { openStudio, sendToStudio, saveFile, isNative } from './bridge.js';
import { t, tErr, lang, setLang } from './i18n.js';

/* global __APP_VERSION__ */
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';
const player = new Player();
let playFrom = 0;
let rendering = false;

// ---------- Mode switch (A Studio | A Voice Studio), above the menu bar ----------
const modeSwitch = h('div', { class: 'mode-switch', role: 'tablist', 'aria-label': t('Switch app') },
  h('button', { class: 'mode-btn', type: 'button', role: 'tab', 'aria-selected': 'false', title: 'A Studio', 'aria-label': 'A Studio', onClick: () => openStudio() }, icon('Piano', 16), h('span', null, 'A Studio')),
  h('button', { class: 'mode-btn on', type: 'button', role: 'tab', 'aria-selected': 'true', title: 'A Voice Studio', 'aria-label': 'A Voice Studio' }, icon('Mic', 16), h('span', null, 'A Voice Studio')),
);

// ---------- Panels ----------
const statusEl = h('div', { class: 'status' });
const hintEl = h('div', { class: 'hint', role: 'status', 'aria-live': 'polite' });
setHintEl(hintEl);

const editor = createEditor({
  onNoteEdit: (n, menu) => (menu ? noteMenu(n) : editLyric(n)),
  onSelect: () => inspector.build(),
  getPlayhead: () => (player.playing ? player.position() : playFrom),
  onSeek: (sec) => seek(sec),
});
const lane = createLane();
const inspector = createInspector({ onLyrics: () => lyricsDialog() });
const browser = createBrowser({ onProjects: projectsPanel, onRunPlugin: (p) => applyPlugin(p), onEditPlugin: (p) => pluginEditor(p) });

const tracksEl = h('div', { class: 'tracks', role: 'tablist', 'aria-label': t('Tracks') });

// ---------- Toolbar ----------
const playBtn = iconBtn('Play', t('Play (space)'), () => togglePlay(), 'play');
const timeEl = h('div', { class: 'lcd', title: t('Position') }, '0:00.0');
const bpmEl = h('input', { class: 'input bpm', type: 'number', min: 20, max: 400, step: 1, 'aria-label': t('Tempo'), title: t('Tempo (BPM)'), onChange: (e) => store.change((p) => { p.bpm = Math.max(20, Math.min(400, Number(e.target.value) || 120)); }) });
const toolBtns = [
  ['select', 'MousePointer2', t('Select (S)')],
  ['draw', 'Pencil', t('Draw notes (D)')],
  ['pitch', 'Spline', t('Draw the pitch (P)')],
  ['erase', 'Eraser', t('Erase (E)')],
].map(([id, ic, label]) => {
  const b = iconBtn(ic, label, () => { ui.tool = id; refreshTools(); hint(label); });
  b.dataset.tool = id;
  return b;
});
const SNAPS = [[PPQ, '1/4'], [PPQ / 2, '1/8'], [PPQ / 4, '1/16'], [PPQ / 8, '1/32'], [PPQ / 3, '1/8T'], [15, t('free')]];
const snapSel = select({ label: t('Snap'), value: ui.snap, options: SNAPS.map(([v, l]) => ({ value: v, label: l })), onChange: (v) => { ui.snap = Number(v); } });
const renderBtn = textBtn(t('Render'), () => renderAll(), 'render', 'Sparkles');
const toolbar = h('div', { class: 'toolbar' },
  h('div', { class: 'tgrp' }, playBtn, iconBtn('Square', t('Stop'), () => stop()), timeEl),
  h('div', { class: 'tgrp' }, bpmEl, h('span', { class: 'unit' }, 'BPM')),
  h('div', { class: 'tgrp tools' }, ...toolBtns),
  h('div', { class: 'tgrp' }, icon('Magnet', 16), snapSel),
  h('div', { class: 'tgrp' }, iconBtn('ZoomOut', t('Zoom out'), () => editor.zoom(1 / 1.3)), iconBtn('ZoomIn', t('Zoom in'), () => editor.zoom(1.3))),
  h('div', { class: 'tgrp' }, iconBtn('Undo2', t('Undo'), () => store.undo()), iconBtn('Redo2', t('Redo'), () => store.redo())),
  h('div', { class: 'tgrp grow' }),
  h('div', { class: 'tgrp' }, renderBtn, iconBtn('PanelLeft', t('Browser'), () => togglePanel('browser')), iconBtn('PanelRight', t('Inspector'), () => togglePanel('inspector'))),
);
function refreshTools() {
  toolBtns.forEach((b) => b.classList.toggle('on', b.dataset.tool === ui.tool));
}

// ---------- Menu bar ----------
const MENUS = {
  FILE: () => [
    { label: t('New project'), icon: 'Plus', onClick: newProj },
    { label: t('Open...'), icon: 'FolderOpen', key: 'Ctrl+O', onClick: openFile },
    { label: t('Save'), icon: 'Save', key: 'Ctrl+S', onClick: () => saveProj() },
    { label: t('Save as...'), icon: 'Save', onClick: () => saveProj(true) },
    { label: t('Projects on this device'), icon: 'FolderOpen', onClick: () => { showPanel('browser', true); browser.show('projects'); } },
    { label: t('Download the project file (.avsp)'), icon: 'Download', onClick: downloadProj },
    { sep: true },
    { label: t('Export WAV (mix)'), icon: 'Download', onClick: () => exportWav() },
    { label: t('Export WAV of the current track'), icon: 'Download', onClick: () => exportWav(store.track().id) },
    { label: t('Send to A Studio'), icon: 'Send', onClick: sendStudio },
  ],
  EDIT: () => [
    { label: t('Undo'), icon: 'Undo2', key: 'Ctrl+Z', onClick: () => store.undo() },
    { label: t('Redo'), icon: 'Redo2', key: 'Ctrl+Y', onClick: () => store.redo() },
    { sep: true },
    { label: t('Select all'), key: 'Ctrl+A', onClick: selectAll },
    { label: t('Copy'), icon: 'Copy', key: 'Ctrl+C', onClick: copyNotes },
    { label: t('Paste'), icon: 'ClipboardPaste', key: 'Ctrl+V', onClick: pasteNotes },
    { label: t('Delete'), icon: 'Trash2', key: 'Del', onClick: deleteNotes },
    { sep: true },
    { label: t('Lyrics for the notes...'), icon: 'Type', key: 'L', onClick: () => lyricsDialog() },
    { label: t('Up one semitone'), onClick: () => transpose(1) },
    { label: t('Down one semitone'), onClick: () => transpose(-1) },
    { label: t('Up one octave'), onClick: () => transpose(12) },
    { label: t('Down one octave'), onClick: () => transpose(-12) },
    { label: t('Quantize to the snap'), icon: 'Magnet', onClick: quantize },
  ],
  VOICE: () => [
    { label: t('Import a voice (UTAU, DiffSinger, vocoder)...'), icon: 'Upload', onClick: () => browser.importVoice() },
    { label: t('Add a VOICEVOX engine...'), icon: 'Server', onClick: () => browser.addEngine() },
    { label: t('Voice library'), icon: 'Mic', onClick: () => { showPanel('browser', true); browser.show('voices'); } },
    { sep: true },
    { label: t('Humanizer for UTAU voices...'), icon: 'Bot', onClick: humanizerDialog },
  ],
  TRACK: () => [
    { label: t('New track'), icon: 'Plus', onClick: addTrack },
    { label: t('Duplicate track'), icon: 'Copy', onClick: duplicateTrack },
    { label: t('Rename track'), icon: 'Pencil', onClick: renameTrack },
    { label: t('Delete track'), icon: 'Trash2', onClick: deleteTrack },
  ],
  RENDER: () => [
    { label: t('Render all'), icon: 'Sparkles', onClick: () => renderAll() },
    { label: t('Clear the render cache'), icon: 'RefreshCw', onClick: () => { clearCache(); store.emit(); hint(t('Render cache cleared')); } },
    { label: t('Export WAV (mix)'), icon: 'Download', onClick: () => exportWav() },
  ],
  VIEW: () => [
    { label: t('Browser'), checked: !document.body.classList.contains('no-browser'), onClick: () => togglePanel('browser') },
    { label: t('Inspector'), checked: !document.body.classList.contains('no-inspector'), onClick: () => togglePanel('inspector') },
    { label: t('Parameter lane'), checked: !document.body.classList.contains('no-lane'), onClick: () => togglePanel('lane') },
    { label: t('Pitch curve'), checked: ui.showPitch, onClick: () => { ui.showPitch = !ui.showPitch; editor.draw(); } },
    { sep: true },
    { label: t('Themes'), icon: 'Palette', onClick: () => { showPanel('browser', true); browser.show('themes'); } },
    { label: lang === 'fr' ? 'English' : 'Français', icon: 'Languages', onClick: () => { setLang(lang === 'fr' ? 'en' : 'fr'); location.reload(); } },
  ],
  TOOLS: () => [
    { label: t('Plugins'), icon: 'Puzzle', onClick: () => { showPanel('browser', true); browser.show('plugins'); } },
    { label: t('New plugin...'), icon: 'Plus', onClick: () => pluginEditor(null) },
  ],
  HELP: () => [
    { label: t('Quick guide'), icon: 'BookOpen', onClick: guide },
    { label: t('About A Voice Studio'), icon: 'Info', onClick: about },
  ],
};
const MENU_LABELS = { FILE: t('FILE'), EDIT: t('EDIT'), VOICE: t('VOICE'), TRACK: t('TRACK'), RENDER: t('RENDER'), VIEW: t('VIEW'), TOOLS: t('TOOLS'), HELP: t('HELP') };
const menuBar = h('nav', { class: 'menubar', 'aria-label': t('Menu') }, Object.keys(MENUS).map((k) => h('button', { class: 'menubar-item', type: 'button', onClick: (e) => openMenu(e.currentTarget, MENUS[k]()) }, MENU_LABELS[k])));

// ---------- Layout ----------
const center = h('main', { class: 'center' }, tracksEl, editor.el, lane.el);
const app = h('div', { class: 'app' },
  h('header', { class: 'top' }, modeSwitch),
  menuBar,
  toolbar,
  h('div', { class: 'body' }, browser.el, center, inspector.el),
  h('footer', { class: 'foot' }, statusEl, hintEl, h('span', { class: 'ver' }, 'A Voice Studio ' + VERSION)),
);
document.body.append(app);

const isNarrow = () => window.innerWidth < 900;
function togglePanel(name) {
  document.body.classList.toggle('no-' + name);
  // Small screens: the panels cover the editor, so only one opens at a time.
  if (isNarrow() && !document.body.classList.contains('no-' + name)) for (const o of ['browser', 'inspector']) if (o !== name) document.body.classList.add('no-' + o);
  try {
    localStorage.setItem('avs:panels', JSON.stringify(['browser', 'inspector', 'lane'].filter((p) => document.body.classList.contains('no-' + p))));
  } catch {
    /* ignore */
  }
  requestAnimationFrame(() => { editor.draw(); lane.draw(); });
}
function showPanel(name, on) {
  document.body.classList.toggle('no-' + name, !on);
  if (on && isNarrow()) for (const o of ['browser', 'inspector']) if (o !== name) document.body.classList.add('no-' + o);
}
// Small screens: touching the editor closes an open panel.
center.addEventListener('pointerdown', () => {
  if (isNarrow()) for (const o of ['browser', 'inspector']) document.body.classList.add('no-' + o);
}, true);
try {
  const hidden = JSON.parse(localStorage.getItem('avs:panels') || 'null');
  const narrow = window.innerWidth < 900;
  for (const p of narrow ? ['browser', 'inspector'] : hidden || []) document.body.classList.add('no-' + p);
} catch {
  /* ignore */
}

// ---------- Tracks ----------
function buildTracks() {
  const p = store.project;
  const chips = p.tracks.map((tr) => h('div', {
    class: 'track' + (tr.id === p.current ? ' on' : '') + (tr.mute ? ' muted' : ''), role: 'tab', 'aria-selected': String(tr.id === p.current), tabindex: 0,
    onClick: () => { if (p.current !== tr.id) { p.current = tr.id; ui.sel.clear(); store.emit(); } },
    onContextmenu: (e) => { e.preventDefault(); trackMenu(e, tr); },
  },
  h('span', { class: 'tdot', style: { background: TRACK_COLORS[tr.color % TRACK_COLORS.length] } }),
  h('span', { class: 'tname' }, tr.name),
  h('button', { class: 'tm' + (tr.mute ? ' on' : ''), type: 'button', title: t('Mute'), 'aria-label': t('Mute'), onClick: (e) => { e.stopPropagation(); store.change(() => { tr.mute = !tr.mute; }); } }, 'M'),
  h('button', { class: 'ts' + (tr.solo ? ' on' : ''), type: 'button', title: t('Solo'), 'aria-label': t('Solo'), onClick: (e) => { e.stopPropagation(); store.change(() => { tr.solo = !tr.solo; }); } }, 'S'),
  h('button', { class: 'tmore', type: 'button', title: t('More'), 'aria-label': t('More'), onClick: (e) => { e.stopPropagation(); trackMenu(e.currentTarget, tr); } }, icon('ChevronDown', 14))));
  tracksEl.replaceChildren(...chips, iconBtn('Plus', t('New track'), addTrack, 'small add-track'));
}
function trackMenu(anchor, tr) {
  openMenu(anchor.getBoundingClientRect ? anchor : { x: anchor.clientX, y: anchor.clientY }, [
    { header: tr.name },
    { label: t('Rename track'), icon: 'Pencil', onClick: () => { store.project.current = tr.id; renameTrack(); } },
    { label: t('Color'), icon: 'Palette', onClick: () => store.change(() => { tr.color = (tr.color + 1) % TRACK_COLORS.length; }) },
    { label: t('Duplicate track'), icon: 'Copy', onClick: () => { store.project.current = tr.id; duplicateTrack(); } },
    { label: t('Delete track'), icon: 'Trash2', onClick: () => { store.project.current = tr.id; deleteTrack(); } },
  ]);
}
function addTrack() {
  store.change((p) => {
    const tr = makeTrack(p.tracks.length, store.track().voice);
    p.tracks.push(tr);
    p.current = tr.id;
  });
  ui.sel.clear();
}
function duplicateTrack() {
  store.change((p) => {
    const src = store.track();
    const copy = normalizeProject({ tracks: [JSON.parse(serialize(src))] }).tracks[0];
    copy.id = makeTrack(0).id;
    copy.name = src.name + ' 2';
    copy.color = (src.color + 1) % TRACK_COLORS.length;
    copy.notes.forEach((n) => { n.id = makeNote(0, 60).id; });
    p.tracks.splice(p.tracks.indexOf(src) + 1, 0, copy);
    p.current = copy.id;
  });
}
async function renameTrack() {
  const v = await promptText(t('Track name'), store.track().name);
  if (v) store.change(() => { store.track().name = v.slice(0, 40); });
}
async function deleteTrack() {
  const p = store.project;
  if (p.tracks.length <= 1) return hint(t('A project keeps at least one track'));
  if (!(await confirmBox(t('Delete track'), store.track().name + ': ' + t('delete this track and its notes?'), t('Delete')))) return;
  store.change((pp) => {
    const i = pp.tracks.indexOf(store.track());
    pp.tracks.splice(i, 1);
    pp.current = pp.tracks[Math.max(0, i - 1)].id;
  });
}

// ---------- Notes ----------
const selected = () => store.track().notes.filter((n) => ui.sel.has(n.id));
function selectAll() {
  ui.sel = new Set(store.track().notes.map((n) => n.id));
  editor.draw();
  inspector.build();
}
let clipboard = [];
function copyNotes() {
  const s = selected();
  if (!s.length) return hint(t('Select notes first'));
  const t0 = Math.min(...s.map((n) => n.t));
  clipboard = s.map((n) => ({ ...JSON.parse(JSON.stringify(n)), t: n.t - t0 }));
  hint(s.length + ' ' + t('notes copied'));
}
function pasteNotes() {
  if (!clipboard.length) return;
  const at = Math.round(((player.playing ? player.position() : playFrom) * store.project.bpm * PPQ) / 60 / ui.snap) * ui.snap;
  store.change(() => {
    ui.sel.clear();
    for (const c of clipboard) {
      const n = { ...JSON.parse(JSON.stringify(c)), id: makeNote(0, 60).id, t: at + c.t };
      store.track().notes.push(n);
      ui.sel.add(n.id);
    }
    store.track().notes.sort((a, b) => a.t - b.t);
  });
}
function deleteNotes() {
  if (!ui.sel.size) return;
  store.change(() => {
    const tr = store.track();
    tr.notes = tr.notes.filter((n) => !ui.sel.has(n.id));
  });
  ui.sel.clear();
}
function transpose(d) {
  const s = selected().length ? selected() : store.track().notes;
  if (!s.length) return;
  const ids = new Set(s.map((n) => n.id));
  store.change(() => { for (const n of store.track().notes) if (ids.has(n.id)) n.key = Math.max(0, Math.min(127, n.key + d)); });
}
function quantize() {
  const s = selected().length ? selected() : store.track().notes;
  const ids = new Set(s.map((n) => n.id));
  store.change(() => {
    for (const n of store.track().notes) {
      if (!ids.has(n.id)) continue;
      n.t = Math.round(n.t / ui.snap) * ui.snap;
      n.len = Math.max(ui.snap, Math.round(n.len / ui.snap) * ui.snap);
    }
  });
}

// Lyric of one note: letters become kana; "Next" goes to the following note.
function editLyric(n) {
  const input = h('input', { class: 'input lyric-input', value: n.lyric, 'aria-label': t('Lyric'), autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' });
  const preview = h('div', { class: 'note' });
  const show = () => { preview.textContent = t('Sung as: ') + (normalizeLyric(input.value) || '—'); };
  input.addEventListener('input', show);
  show();
  const apply = () => {
    const v = normalizeLyric(input.value);
    if (v && v !== n.lyric) store.change(() => { const x = store.track().notes.find((y) => y.id === n.id); if (x) x.lyric = v; });
    ui.nextLyric = v || ui.nextLyric;
  };
  const go = (d) => {
    apply();
    const notes = store.track().notes;
    const i = notes.findIndex((x) => x.id === n.id);
    const next = notes[i + d];
    m.close();
    if (next) {
      ui.sel = new Set([next.id]);
      editor.draw();
      editLyric(next);
    }
  };
  const m = openModal({
    title: t('Lyric'),
    body: h('div', null, input, preview, h('p', { class: 'note' }, t('Type letters (ka, shi, tsu, n...) or kana. "-" holds the vowel of the note before, "R" is a rest, "br" a breath.'))),
    actions: [{ label: t('Previous'), onClick: () => { go(-1); return false; } }, { label: t('Next'), onClick: () => { go(1); return false; } }, { label: t('OK'), primary: true, onClick: apply }],
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { apply(); m.close(); }
    if (e.key === 'Tab') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
  });
  setTimeout(() => { input.focus(); input.select(); }, 30);
}

function noteMenu(n) {
  const r = editor.el.getBoundingClientRect();
  openMenu({ x: r.left + r.width / 2, y: r.top + 60 }, [
    { header: normalizeLyric(n.lyric) || '—' },
    { label: t('Edit the lyric'), icon: 'Type', onClick: () => editLyric(n) },
    { label: n.vib.depth > 0 ? t('Remove the vibrato') : t('Add a vibrato'), icon: 'Activity', onClick: () => store.change(() => { const x = store.track().notes.find((y) => y.id === n.id); if (x) x.vib.depth = x.vib.depth > 0 ? 0 : 45; }) },
    { label: t('Split in two'), icon: 'Scissors', onClick: () => store.change(() => {
      const x = store.track().notes.find((y) => y.id === n.id);
      if (!x || x.len < 30) return;
      const half = Math.max(15, Math.round(x.len / 2 / 15) * 15);
      const b = { ...JSON.parse(JSON.stringify(x)), id: makeNote(0, 60).id, t: x.t + half, len: x.len - half, lyric: '-' };
      x.len = half;
      store.track().notes.push(b);
      store.track().notes.sort((p, q) => p.t - q.t);
    }) },
    { label: t('Delete'), icon: 'Trash2', onClick: () => store.change(() => { const tr = store.track(); tr.notes = tr.notes.filter((y) => y.id !== n.id); }) },
  ]);
}

// Lyrics for many notes at once: one mora per note, from the selection (or all notes).
function lyricsDialog() {
  const tr = store.track();
  const targets = selected().length ? selected() : tr.notes;
  const input = h('textarea', { class: 'input lyrics-area', rows: 4, placeholder: 'ka re ga su ki - na no', 'aria-label': t('Lyrics') }, targets.map((n) => n.lyric).join(' '));
  const preview = h('div', { class: 'note' });
  const show = () => {
    const parts = lyricsForNotes(input.value);
    preview.textContent = parts.slice(0, 64).join(' ') + (parts.length > 64 ? ' ...' : '') + '  (' + parts.length + ' / ' + targets.length + ' ' + t('notes') + ')';
  };
  input.addEventListener('input', show);
  show();
  openModal({
    title: t('Lyrics for the notes'),
    body: h('div', null, h('p', { class: 'note' }, t('Type the lyrics with letters (romaji) or kana. They are split into one syllable per note, from the first selected note.')), input, preview),
    actions: [{ label: t('Cancel') }, { label: t('Apply'), primary: true, onClick: () => {
      const parts = lyricsForNotes(input.value);
      const ids = targets.map((n) => n.id);
      store.change(() => {
        const notes = store.track().notes;
        ids.forEach((id, i) => { const n = notes.find((x) => x.id === id); if (n && parts[i]) n.lyric = parts[i]; });
      });
      hint(Math.min(parts.length, ids.length) + ' ' + t('lyrics set'));
    } }],
  });
  setTimeout(() => input.focus(), 30);
}

// ---------- Plugins ----------
async function applyPlugin(p) {
  const tr = store.track();
  const sel = selected();
  const notes = sel.length ? sel : tr.notes;
  if (!notes.length) return hint(t('No notes to change'));
  try {
    const out = await runPlugin(p.code, notes, { ppq: PPQ, bpm: store.project.bpm, beats: store.project.beats, selection: !!sel.length });
    const ids = new Set(notes.map((n) => n.id));
    store.change(() => {
      const track = store.track();
      track.notes = track.notes.filter((n) => !ids.has(n.id)).concat(out.map((n) => ({ ...makeNote(n.t, n.key, n.len, n.lyric), ...n, id: n.id || makeNote(0, 60).id })));
      track.notes.sort((a, b) => a.t - b.t);
      ui.sel = new Set(sel.length ? out.map((n) => n.id).filter(Boolean) : []);
    });
    hint(p.name + ': ' + out.length + ' ' + t('notes'));
  } catch (e) {
    alertBox(p.name, tErr((e && e.message) || e));
  }
}

function pluginEditor(p) {
  const code = h('textarea', { class: 'input code', rows: 16, spellcheck: 'false', 'aria-label': t('Plugin code') }, p ? p.code : `// @name My plugin
// @description What it does
export default function run(notes, ctx) {
  // notes: [{ t, len, key, lyric, vel, porta, vib }] (t and len in ticks, ${PPQ} per beat)
  return notes.map((n) => ({ ...n }));
}`);
  openModal({
    title: p ? p.name : t('New plugin'),
    wide: true,
    body: h('div', null, h('p', { class: 'note' }, t('A plugin gets the notes and returns the new notes. It runs apart from the page, without access to your files.')), code),
    actions: [
      { label: t('Cancel') },
      { label: t('Try on the selection'), onClick: async () => {
        try {
          pluginInfo(code.value);
          await applyPlugin({ name: t('Test'), code: code.value });
        } catch (e) {
          alertBox(t('Plugin'), tErr((e && e.message) || e));
        }
        return false;
      } },
      { label: t('Install'), primary: true, onClick: async () => {
        try {
          const info = await installPlugin(code.value);
          hint(info.name + ' ' + t('installed'));
          browser.build();
        } catch (e) {
          alertBox(t('Plugin'), tErr((e && e.message) || e));
          return false;
        }
      } },
    ],
  });
}

// ---------- Humanizer ----------
async function humanizerDialog() {
  let models = [];
  try {
    models = (await listVoices()).filter((v) => v.type === 'humanizer');
  } catch {
    models = [];
  }
  const sel = select({ label: t('Humanizer'), value: settings.humanizer, options: [{ value: 'ai', label: t('AI model (built-in, local, trained on real singers)') }, { value: 'builtin', label: t('Rules (light, offline)') }, ...models.map((m) => ({ value: m.id, label: m.name + ' (ONNX)' }))], onChange: async (v) => { settings.humanizer = v; await kv.set('humanizer', v); clearCache(); store.emit(); } });
  const amt = h('input', { type: 'range', class: 'range', min: 0, max: 2, step: 0.05, value: settings.humanizeAmount, 'aria-label': t('Amount'), onChange: async (e) => { settings.humanizeAmount = Number(e.target.value); await kv.set('humanizeAmount', settings.humanizeAmount); clearCache(); store.emit(); } });
  openModal({
    title: t('Humanizer for UTAU voices'),
    body: h('div', { class: 'form' },
      h('p', { class: 'note' }, t('UTAU voices join recordings, so their pitch can sound flat. The humanizer gives it the moves of a real singer. Turn it on per track in the inspector ("Humanize"). It is off by default.')),
      h('p', { class: 'note' }, t('AI model: a small neural network (about 100 KB) that runs on this device. It was trained on the pitch curves of 17 real singers (M4Singer corpus, CC BY-NC-SA 4.0) to turn flat notes into sung pitch: glides, overshoots, preparations. Rules: simple built-in moves (drift, vibrato, fall at the end).')),
      h('label', { class: 'field' }, h('span', null, t('Model')), sel),
      h('label', { class: 'field' }, h('span', null, t('Amount')), amt),
      h('p', { class: 'note' }, t('You can import your own humanizer model (.onnx, local): input "f0" [1, T] in MIDI notes at 100 frames per second, output the humanized pitch [1, T]. Import it with VOICE > Import a voice.')),
    ),
  });
}

// ---------- Projects ----------
async function projectsPanel(match) {
  let keys = [];
  try {
    keys = (await kv.keys()).filter((k) => String(k).startsWith('project:')).map((k) => String(k).slice(8)).filter(match).sort();
  } catch {
    keys = [];
  }
  return h('div', null,
    h('div', { class: 'br-actions' }, textBtn(t('Save'), () => saveProj(), 'primary', 'Save'), textBtn(t('Open a file'), openFile, '', 'FolderOpen')),
    keys.length ? keys.map((name) => h('div', { class: 'pcard', role: 'button', tabindex: 0, onClick: () => openSaved(name) },
      icon('FileMusic', 18), h('div', { class: 'vtext' }, h('div', { class: 'vname' }, name)),
      iconBtn('Trash2', t('Delete'), async (e) => {
        e.stopPropagation();
        if (!(await confirmBox(t('Delete'), name + ': ' + t('delete this project?'), t('Delete')))) return;
        await kv.del('project:' + name);
        browser.build();
      }, 'small'))) : h('p', { class: 'br-note' }, t('No project saved yet. FILE > Save keeps it on this device.')),
    h('p', { class: 'br-note' }, t('Open .avsp projects, UTAU .ust files or MIDI files (with lyrics).')));
}
async function saveProj(asNew = false) {
  let name = store.project.name;
  if (asNew || !name || name === 'Untitled') {
    const v = await promptText(t('Project name'), name === 'Untitled' ? '' : name);
    if (!v) return;
    name = v.slice(0, 60);
    store.project.name = name;
  }
  await kv.set('project:' + name, serialize(store.project));
  hint(t('Saved: ') + name);
  browser.build();
}
async function openSaved(name) {
  const raw = await kv.get('project:' + name);
  if (!raw) return;
  stop();
  store.load(JSON.parse(raw));
  ui.sel.clear();
  hint(t('Opened: ') + name);
}
async function newProj() {
  if (store.project.tracks.some((tr) => tr.notes.length) && !(await confirmBox(t('New project'), t('Start a new project? Unsaved changes are lost.'), t('New')))) return;
  stop();
  store.load(newProject());
  ui.sel.clear();
}
async function openFile() {
  const [f] = await pickFiles('.avsp,.json,.ust,.mid,.midi');
  if (!f) return;
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (/\.ust$/i.test(f.name) || /\.midi?$/i.test(f.name)) {
      const r = /\.ust$/i.test(f.name) ? parseUst(bytes) : parseMidi(bytes);
      store.change((p) => {
        const tr = store.track().notes.length ? makeTrack(p.tracks.length, store.track().voice) : store.track();
        tr.notes = r.notes;
        tr.name = f.name.replace(/\.[^.]+$/, '').slice(0, 40);
        if (!p.tracks.includes(tr)) p.tracks.push(tr);
        p.current = tr.id;
        if (r.tempo) p.bpm = Math.max(20, Math.min(400, r.tempo));
      });
      if (r.notes.length) editor.centreOn(r.notes[0].key);
      hint(r.notes.length + ' ' + t('notes imported'));
    } else {
      stop();
      store.load(JSON.parse(new TextDecoder().decode(bytes)));
      hint(t('Opened: ') + store.project.name);
    }
  } catch (e) {
    alertBox(t('Open'), tErr((e && e.message) || e));
  }
}
function downloadProj() {
  saveFile((store.project.name || 'project') + '.avsp', new TextEncoder().encode(serialize(store.project)), 'application/json').then((r) => hint(r.where === 'download' ? t('Downloaded') : t('Saved in ') + r.where));
}

// ---------- Render, play, export ----------
async function renderAll(quiet = false) {
  if (rendering) return false;
  rendering = true;
  renderBtn.classList.add('busy');
  try {
    const r = await renderProject(store.project, { onProgress: (d, n, name) => { statusEl.textContent = n ? t('Rendering ') + (d + 1 > n ? n : d + 1) + ' / ' + n + (name ? ' · ' + name : '') : ''; } });
    statusEl.textContent = '';
    editor.draw();
    if (r.needVocoder) browser.offerVocoder();
    else if (r.problems.length) alertBox(t('Render'), r.problems.slice(0, 12).join('\n'));
    else if (!quiet) hint(r.rendered ? r.rendered + ' ' + t('phrases rendered') : t('Everything is rendered'));
    return true;
  } finally {
    rendering = false;
    renderBtn.classList.remove('busy');
  }
}
let starting = false;
async function togglePlay() {
  // Pause: the playhead stays where it is, a new press goes on from there.
  if (player.playing) return stop(true);
  // A second press while the phrases are still rendering cancels the start.
  if (starting) {
    starting = false;
    return;
  }
  starting = true;
  await renderAll(true);
  if (!starting) return;
  starting = false;
  player.play(store.project, playFrom);
  playBtn.classList.add('on');
}
// Stop (button, or the end of the song): the playhead goes back to the beginning and the
// editor scrolls back to it. Pause (space) keeps the position: stop(true).
function stop(keep = false) {
  starting = false;
  if (player.playing && keep) playFrom = player.position();
  else playFrom = 0;
  player.stop();
  playBtn.classList.remove('on');
  timeEl.textContent = fmt(playFrom);
  if (!keep) editor.follow(0);
  editor.drawHead();
}
function seek(sec) {
  const wasPlaying = player.playing;
  playFrom = Math.max(0, sec);
  if (wasPlaying) player.play(store.project, playFrom);
  editor.drawHead();
  timeEl.textContent = fmt(playFrom);
}
const fmt = (s) => Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0');

async function exportWav(only = null) {
  await renderAll(true);
  const mix = mixdown(store.project, { only });
  if (mix.L.length < 10) return hint(t('Nothing to export: add notes first'));
  const name = (store.project.name || 'song') + (only ? ' - ' + store.track().name : '') + '.wav';
  const r = await saveFile(name, encodeWav([mix.L, mix.R], mix.sr), 'audio/wav');
  hint(r.where === 'download' ? t('Exported: ') + name : t('Saved in ') + r.where);
}
async function sendStudio() {
  await renderAll(true);
  const mix = mixdown(store.project);
  if (mix.L.length < 10) return hint(t('Nothing to send: add notes first'));
  const name = (store.project.name === 'Untitled' ? 'Vocal' : store.project.name) + '.wav';
  try {
    const r = await sendToStudio(name, encodeWav([mix.L, mix.R], mix.sr), mix.L.length / mix.sr);
    if (r.mode === 'library') {
      if (await confirmBox(t('Send to A Studio'), t('The song is in A Studio, in the browser folder "A Voice Studio". Open A Studio now?'), t('Open A Studio'))) openStudio();
    } else alertBox(t('Send to A Studio'), t('The song is saved in ') + r.where + '. ' + t('In A Studio, import it with the import button of the browser (or pick A Studio in the share window).'));
  } catch (e) {
    alertBox(t('Send to A Studio'), tErr((e && e.message) || e));
  }
}

// ---------- Help ----------
function guide() {
  openModal({
    title: t('Quick guide'),
    wide: true,
    body: h('div', { class: 'guide' },
      h('p', null, t('1. Pick a voice in the browser (left): a built-in vocoder voice works right away. Import UTAU / OpenUTAU or DiffSinger banks, or add a VOICEVOX engine.')),
      h('p', null, t('2. Draw notes with the pencil. Double tap a note to type its lyric in letters (ka, shi, n...): it becomes kana by itself. EDIT > Lyrics for the notes types a whole phrase.')),
      h('p', null, t('3. Shape the voice: the pitch pencil draws pitch bends on the notes, the lane below draws dynamics, breathiness, gender and tension. The inspector (right) sets vibrato and portamento.')),
      h('p', null, t('4. Press play: changed phrases render first (the line under the ruler turns green when ready). Export a WAV or send it to A Studio.')),
      h('p', null, t('Two fingers move and zoom the editor. Long press a note for more choices.')),
    ),
  });
}
function about() {
  openModal({
    title: 'A Voice Studio',
    body: h('div', null,
      h('p', null, 'A Voice Studio ' + VERSION + ' · ' + t('extension of A Studio')),
      h('p', { class: 'note' }, t('DiffSinger models run on this device with ONNX Runtime. UTAU voicebanks are rendered here with PSOLA. VOICEVOX voices are rendered by a VOICEVOX engine you run. Voicebanks keep their own licences: check the readme of each voice before publishing songs.')),
    ),
  });
}

// ---------- Refresh ----------
let savePending = null;
store.subscribe(() => {
  buildTracks();
  browser.markActive();
  editor.draw();
  lane.draw();
  inspector.build();
  bpmEl.value = String(store.project.bpm);
  clearTimeout(savePending);
  savePending = setTimeout(() => kv.set('autosave', serialize(store.project)).catch(() => {}), 800);
});

function frame() {
  if (player.playing) {
    const pos = player.position();
    timeEl.textContent = fmt(pos);
    editor.drawHead();
    editor.follow(pos);
    // Stop after the last phrase.
    const end = Math.max(0, ...store.project.tracks.flatMap((tr) => trackPhrases(tr, store.project).map((p) => p.ph.end)));
    if (pos > end + 0.3) stop();
  }
  requestAnimationFrame(frame);
}

// ---------- Keyboard ----------
window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.querySelector('.overlay')) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (e.key === ' ') togglePlay();
  else if (mod && k === 'z') store.undo();
  else if (mod && k === 'y') store.redo();
  else if (mod && k === 's') saveProj();
  else if (mod && k === 'o') openFile();
  else if (mod && k === 'a') selectAll();
  else if (mod && k === 'c') copyNotes();
  else if (mod && k === 'v') pasteNotes();
  else if (e.key === 'Delete' || e.key === 'Backspace') deleteNotes();
  else if (k === 's') { ui.tool = 'select'; refreshTools(); }
  else if (k === 'd') { ui.tool = 'draw'; refreshTools(); }
  else if (k === 'p') { ui.tool = 'pitch'; refreshTools(); }
  else if (k === 'e') { ui.tool = 'erase'; refreshTools(); }
  else if (k === 'l') lyricsDialog();
  else if (e.key === 'ArrowUp' && ui.sel.size) transpose(e.shiftKey ? 12 : 1);
  else if (e.key === 'ArrowDown' && ui.sel.size) transpose(e.shiftKey ? -12 : -1);
  else if (e.key === 'Escape') { closeMenu(); ui.sel.clear(); editor.draw(); inspector.build(); }
  else return;
  e.preventDefault();
});

// ---------- Start ----------
async function start() {
  await loadThemes();
  await loadPlugins();
  try {
    settings.humanizer = (await kv.get('humanizer')) || 'ai';
    settings.humanizeAmount = Number((await kv.get('humanizeAmount')) ?? 1);
    const saved = await kv.get('autosave');
    if (saved) store.load(JSON.parse(saved));
    else demo();
  } catch {
    demo();
  }
  refreshTools();
  browser.build();
  store.emit();
  requestAnimationFrame(frame);
  try {
    if (!localStorage.getItem('avs:guided')) {
      localStorage.setItem('avs:guided', '1');
      setTimeout(guide, 400);
    }
  } catch {
    /* ignore */
  }
}
// First start: a short phrase to hear the built-in voice right away.
function demo() {
  const p = newProject();
  const tr = p.tracks[0];
  const melody = [[0, 67, 'さ'], [1, 69, 'く'], [2, 71, 'ら'], [3, 69, '-'], [4, 67, 'さ'], [5, 64, 'く'], [6, 67, 'ら']];
  tr.notes = melody.map(([b, k, l]) => makeNote(b * PPQ, k, b === 6 ? PPQ * 2 : PPQ, l));
  tr.notes[6].vib.depth = 40;
  p.name = 'Untitled';
  store.load(p);
}
void ticksToSec;
void isNative;
start();
