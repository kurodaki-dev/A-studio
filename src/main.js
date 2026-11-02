import './style.css';
import { h, btn, icon, hint, bindHint, openMenu, openModal, promptText, confirmBox, alertBox, closeMenu } from './ui/dom.js';
import { store, newProject, currentPattern, makePattern, nextPatternIndex, serialize, normalizeProject, notesFor } from './store.js';
import { ui } from './ui-state.js';
import { Engine, renderWav } from './audio/engine.js';
import { createRack } from './ui/rack.js';
import { createPianoRoll } from './ui/pianoroll.js';
import { createPlaylist } from './ui/playlist.js';
import { createMixer } from './ui/mixer.js';
import { createSidebar } from './ui/sidebar.js';
import { addSampler } from './ui/rack.js';
import { initSamples, onSamplesChange, getSampleMeta, getBuffer, loadBuffer } from './samples.js';
import { openChannelSettings } from './ui/channelSettings.js';
import { loadCurrent, saveCurrent, saveProject, loadProject, listProjects } from './persist.js';
import { saveFile, pickFile } from './platform.js';
import { BAR, STEP, NKEYS, clamp } from './constants.js';
import { createExtensionHost } from './extensions.js';
import { isInstrumentId } from './audio/catalog.js';
import { encodeMidi } from './midi.js';
import { APP_VERSION } from './version.js';
import { checkForUpdate, updatesSupported, autoCheckEnabled } from './update.js';
import { t, locale, lang } from './i18n.js';
import { initTheme } from './themes.js';
import { openSettings } from './ui/settings.js';
import { openExternal, DOCS_URL, bugReportUrl, featureRequestUrl } from './links.js';

initTheme();
document.documentElement.lang = lang;

// Restore the last session
const saved = loadCurrent();
if (saved) {
  try {
    store.load(saved);
  } catch {
    store.load(newProject());
  }
}

const engine = new Engine(store, () => (ui.songMode ? 'song' : 'pattern'), () => ui.metronome);
engine.onPluginError = (p, msg) => alertBox(t('Plugin error'), p.name + ': ' + msg);

const actions = {
  openPianoRoll(id) {
    ui.prChannel = id;
    showPanel('piano');
  },
  channelSettings(id) {
    openChannelSettings(id, engine);
  },
  openProject(name) {
    const data = loadProject(name);
    if (!data) return;
    engine.stop();
    try {
      store.load(data);
      hint(t('Project opened: ') + store.project.name);
    } catch (e) {
      alertBox(t('Could not open'), String(e.message || e));
    }
  },
  addSampler(id) {
    addSampler(id);
  },
  toggleSidebar(on) {
    setSidebar(on);
  },
};

const panels = {
  rack: createRack(engine, actions),
  piano: createPianoRoll(engine),
  playlist: createPlaylist(engine, actions),
  mixer: createMixer(engine, () => openSettings({ section: 'extensions', onExtensionsChange: extensionsChanged, engine })),
};
const sidebar = createSidebar(engine, actions);

// Toolbar
const hintEl = h('div', { class: 'hint', 'aria-live': 'polite' });
bindHint(hintEl);

const patBtn = h('button', { class: 'b tb seg', type: 'button', onClick: () => setSongMode(false) }, 'PAT');
const songBtn = h('button', { class: 'b tb seg', type: 'button', onClick: () => setSongMode(true) }, 'SONG');
const playBtn = btn('Play', t('Play / pause (space)'), () => togglePlay(), 'play');
const stopBtn = btn('Square', 'Stop', () => stop(), 'stop');
const recBtn = btn('Circle', t('Record notes played on the piano roll keyboard'), () => {
  ui.recording = !ui.recording;
  hint(ui.recording ? t('Recording armed: play the pattern and use the piano roll keyboard') : t('Recording off'));
  refreshToolbar();
}, 'rec');
const metroBtn = btn('Metronome', t('Metronome'), () => {
  ui.metronome = !ui.metronome;
  hint(t('Metronome ') + (ui.metronome ? t('on') : t('off')));
  refreshToolbar();
});
const tempoVal = h('div', { class: 'lcd tempo', title: t('Tempo: drag vertically, double tap to type') });
const timeVal = h('div', { class: 'lcd time', title: t('Position bar:step:tick') });
const patName = h('button', { class: 'b tb patname', type: 'button', title: t('Patterns'), onClick: (e) => patternMenu(e.currentTarget) });
const undoBtn = btn('Undo2', t('Cancel'), () => { if (store.undo()) hint(t('Undone')); });
const redoBtn = btn('Redo2', t('Redo'), () => { if (store.redo()) hint(t('Redone')); });

const topbar = h('header', { class: 'topbar' },
  btn('Menu', 'Menu', (e) => mainMenu(e.currentTarget)),
  h('div', { class: 'brand' }, 'A STUDIO'),
  h('div', { class: 'tgrp segs' }, patBtn, songBtn),
  h('div', { class: 'tgrp' }, playBtn, stopBtn, recBtn, metroBtn),
  h('div', { class: 'tgrp tempo-grp' },
    btn('Minus', t('Tempo down'), () => setBpm(Math.round(store.project.bpm) - 1), 'small'),
    tempoVal,
    btn('Plus', t('Tempo up'), () => setBpm(Math.round(store.project.bpm) + 1), 'small'),
  ),
  timeVal,
  h('div', { class: 'tgrp' },
    btn('ChevronLeft', t('Previous pattern'), () => stepPattern(-1), 'small'),
    patName,
    btn('ChevronRight', t('Next pattern'), () => stepPattern(1), 'small'),
  ),
  h('div', { class: 'tgrp' }, undoBtn, redoBtn),
  hintEl,
);

const railDefs = [
  ['playlist', 'LayoutList', 'Playlist'],
  ['rack', 'Grid3x3', 'Channel rack'],
  ['piano', 'Piano', 'Piano roll'],
  ['mixer', 'SlidersVertical', 'Mixer'],
];
const railBtns = railDefs.map(([id, ic, label]) => {
  const b = h('button', { class: 'rail-btn', type: 'button', title: label, 'aria-label': label, onClick: () => showPanel(id) }, icon(ic, 20), h('span', null, label.split(' ')[0]));
  b.dataset.panel = id;
  return b;
});
const browserBtn = h('button', { class: 'rail-btn', type: 'button', title: t('Browser (F8)'), 'aria-label': t('Browser'), onClick: () => setSidebar(!ui.sidebar) }, icon('FolderOpen', 20), h('span', null, t('Browser')));
const extRail = h('div', { class: 'ext-rail' });
const rail = h('nav', { class: 'rail' }, browserBtn, h('div', { class: 'rail-sep' }), railBtns, extRail);
const stage = h('main', { class: 'stage' }, Object.values(panels).map((p) => p.el));
const body = h('div', { class: 'body' }, rail, sidebar.el, stage);
document.getElementById('app').append(topbar, body);

function setSidebar(on) {
  ui.sidebar = on;
  body.classList.toggle('side-open', on);
  browserBtn.classList.toggle('on', on);
}
setSidebar(window.innerWidth >= 900);

function showPanel(id) {
  if (!panels[id]) id = 'rack';
  ui.panel = id;
  for (const [k, p] of Object.entries(panels)) p.el.classList.toggle('active', k === id);
  [...railBtns, ...extRail.children].forEach((b) => b.classList.toggle('on', b.dataset.panel === id));
  panels[id].update();
}

// Interface extensions: buttons in the top bar, panels in the rail, menu items.
const extBar = h('div', { class: 'tgrp ext-bar' });
topbar.insertBefore(extBar, hintEl);
const extRuntime = h('div', { class: 'ext-host', 'aria-hidden': 'true' });
document.body.append(extRuntime);
const extMounted = new Map(); // panel key -> rail button

function extState() {
  const pos = engine.position();
  return { playing: engine.playing, bpm: store.project.bpm, mode: ui.songMode ? 'song' : 'pattern', position: Math.round(pos), bar: Math.floor(pos / BAR) + 1, step: Math.floor((pos % BAR) / STEP) + 1 };
}

const findChannel = (ref) => store.project.channels.find((c) => c.id === ref || c.name === ref);

const extActions = {
    play() {
      if (!engine.playing) togglePlay();
      return true;
    },
    stop() {
      stop();
      return true;
    },
    toggle() {
      togglePlay();
      return engine.playing;
    },
    setTempo(v) {
      if (!Number.isFinite(v)) throw new Error('Tempo must be a number');
      setBpm(v);
      return store.project.bpm;
    },
    setMode(song) {
      setSongMode(song);
      return song ? 'song' : 'pattern';
    },
    state: () => extState(),
    projectSummary() {
      const p = store.project;
      return {
        name: p.name,
        bpm: p.bpm,
        stepsPerBar: BAR / STEP,
        currentPattern: p.currentPattern,
        patterns: p.patterns.map((x) => ({ id: x.id, name: x.name })),
        channels: p.channels.map((c) => ({ id: c.id, name: c.name, instrument: c.instrument })),
      };
    },
    // Notes: { channel (id or name), step, length in steps, key (60 = C5), velocity 0 to 1 }
    addNotes(list) {
      let added = 0;
      store.change((p) => {
        const pat = currentPattern(p);
        for (const n of list) {
          if (!n || typeof n !== 'object') continue;
          const c = p.channels.find((x) => x.id === n.channel || x.name === n.channel);
          const step = Number(n.step);
          if (!c || !Number.isFinite(step) || step < 0 || step > 4096) continue;
          const len = Number.isFinite(Number(n.length)) ? Number(n.length) : 1;
          const key = Number.isFinite(Number(n.key)) ? Math.round(Number(n.key)) : 60;
          const vel = Number.isFinite(Number(n.velocity)) ? Number(n.velocity) : 0.78;
          notesFor(pat, c.id).push({ t: Math.round(step * STEP), len: Math.max(1, Math.round(clamp(len, 0.05, 1024) * STEP)), key: clamp(key, 0, NKEYS - 1), vel: clamp(vel, 0, 1) });
          added += 1;
        }
      });
      return added;
    },
    getNotes(ref) {
      const c = findChannel(ref);
      if (!c) throw new Error('Unknown channel');
      return (currentPattern(store.project).notes[c.id] || []).map((n) => ({ step: n.t / STEP, length: n.len / STEP, key: n.key, velocity: n.vel }));
    },
    setNotes(ref, list) {
      const c = findChannel(ref);
      if (!c) throw new Error('Unknown channel');
      const notes = [];
      for (const n of list) {
        if (!n || typeof n !== 'object') continue;
        const step = Number(n.step);
        if (!Number.isFinite(step) || step < 0 || step > 4096) continue;
        const len = Number.isFinite(Number(n.length)) ? Number(n.length) : 1;
        const key = Number.isFinite(Number(n.key)) ? Math.round(Number(n.key)) : 60;
        const vel = Number.isFinite(Number(n.velocity)) ? Number(n.velocity) : 0.78;
        notes.push({ t: Math.round(step * STEP), len: Math.max(1, Math.round(clamp(len, 0.05, 1024) * STEP)), key: clamp(key, 0, NKEYS - 1), vel: clamp(vel, 0, 1) });
      }
      store.change((p) => { currentPattern(p).notes[c.id] = notes; });
      return notes.length;
    },
    // { channel (id or name) or instrument (id such as 'piano'), key, velocity, length in seconds }
    playNote(o) {
      const key = Number.isFinite(Number(o.key)) ? clamp(Math.round(Number(o.key)), 0, NKEYS - 1) : 60;
      const vel = Number.isFinite(Number(o.velocity)) ? clamp(Number(o.velocity), 0, 1) : 0.8;
      const len = Number.isFinite(Number(o.length)) ? clamp(Number(o.length), 0.02, 8) : 0.4;
      if (o.channel != null) {
        const c = findChannel(o.channel);
        if (!c) throw new Error('Unknown channel');
        engine.preview(c, key, vel, len);
      } else if (typeof o.instrument === 'string' && isInstrumentId(o.instrument)) {
        engine.previewInstrument(o.instrument, [key], len);
      } else throw new Error('Give a channel or an instrument');
      return true;
    },
    clearNotes(ref) {
      store.change((p) => {
        const pat = currentPattern(p);
        if (ref == null) pat.notes = {};
        else {
          const c = findChannel(ref);
          if (c) pat.notes[c.id] = [];
        }
      });
      return true;
    },
    selectPattern(ref) {
      const pat = store.project.patterns.find((x) => x.id === ref || x.name === ref);
      if (!pat) throw new Error('Unknown pattern');
      store.project.currentPattern = pat.id;
      store.emit();
      return pat.id;
    },
    hint(text) {
      hint(text);
      return true;
    },
    extensionsUiChanged: () => syncExtensionUi(),
    openPanel: (key) => showPanel(key),
    extensionError: (p, msg) => alertBox(t('Extension error'), p.name + ': ' + msg),
};
const extHost = createExtensionHost({ runtimeHost: extRuntime, actions: extActions });

function syncExtensionUi() {
  extBar.replaceChildren(...extHost.buttons().map((b) => h('button', { class: 'b tb ext-btn', type: 'button', title: b.label, onClick: b.onClick }, b.icon ? icon(b.icon) : null, h('span', null, b.label))));
  const panelsNow = new Map(extHost.panels().map((p) => ['ext:' + p.key, p]));
  for (const [key, btnEl] of extMounted) {
    if (!panelsNow.has(key) || panels[key].iframe !== panelsNow.get(key).frame) {
      panels[key].el.remove();
      btnEl.remove();
      delete panels[key];
      extMounted.delete(key);
    }
  }
  for (const [key, p] of panelsNow) {
    if (extMounted.has(key)) continue;
    const el = h('div', { class: 'panel ext-panel' }, h('div', { class: 'ptools' }, h('div', { class: 'grp' }, icon('Puzzle', 16), h('span', { class: 'ptitle' }, p.title))), h('div', { class: 'ext-wrap' }, p.frame));
    stage.append(el);
    panels[key] = { el, iframe: p.frame, update() {} };
    const b = h('button', { class: 'rail-btn', type: 'button', title: p.title, 'aria-label': p.title, onClick: () => showPanel(key) }, icon(p.icon || 'Puzzle', 20), h('span', null, p.title));
    b.dataset.panel = key;
    extRail.append(b);
    extMounted.set(key, b);
  }
  if (!panels[ui.panel]) showPanel('rack');
}

// Tempo drag
(() => {
  let start = null;
  let lastTap = 0;
  tempoVal.addEventListener('pointerdown', async (e) => {
    tempoVal.setPointerCapture(e.pointerId);
    const now = performance.now();
    if (now - lastTap < 300) {
      lastTap = 0;
      start = null;
      const v = await promptText('Tempo (BPM)', String(store.project.bpm));
      const n = v ? Number(v.replace(',', '.')) : NaN;
      if (Number.isFinite(n)) setBpm(n);
      return;
    }
    lastTap = now;
    start = { y: e.clientY, v: store.project.bpm, began: false };
  });
  tempoVal.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dy = start.y - e.clientY;
    if (!start.began && Math.abs(dy) < 3) return;
    if (!start.began) {
      start.began = true;
      store.commit();
    }
    store.project.bpm = clamp(Math.round(start.v + dy / 3), 10, 522);
    hint(t('Tempo: ') + store.project.bpm + ' BPM');
    store.emit();
  });
  const end = () => { start = null; };
  tempoVal.addEventListener('pointerup', end);
  tempoVal.addEventListener('pointercancel', end);
})();

function setBpm(v) {
  const n = clamp(Math.round(v * 1000) / 1000, 10, 522);
  if (n === store.project.bpm) return;
  store.change((p) => { p.bpm = n; });
  hint(t('Tempo: ') + n + ' BPM');
}

function setSongMode(on) {
  if (ui.songMode === on) return;
  const was = engine.playing;
  engine.stop();
  ui.songMode = on;
  if (was) engine.play();
  hint(on ? t('Song mode: plays the playlist') : t('Pattern mode: plays the current pattern'));
  refreshToolbar();
  panels[ui.panel].update();
}

function togglePlay() {
  engine.togglePlay();
  refreshToolbar();
}

function stop() {
  engine.stop();
  refreshToolbar();
  panels[ui.panel].update();
}

function stepPattern(d) {
  const p = store.project;
  const i = p.patterns.findIndex((x) => x.id === p.currentPattern);
  const next = i + d;
  if (next < 0) return;
  if (next >= p.patterns.length) {
    newPattern();
    return;
  }
  p.currentPattern = p.patterns[next].id;
  store.emit();
}

function newPattern() {
  store.change((p) => {
    const pat = makePattern(nextPatternIndex(p));
    p.patterns.push(pat);
    p.currentPattern = pat.id;
  });
  hint(t('New pattern: ') + currentPattern(store.project).name);
}

function patternMenu(anchor) {
  const p = store.project;
  const cur = currentPattern(p);
  openMenu(anchor, [
    ...p.patterns.map((pt) => ({ label: pt.name, checked: pt.id === p.currentPattern, onClick: () => { p.currentPattern = pt.id; store.emit(); } })),
    { sep: true },
    { label: t('New pattern'), icon: 'Plus', onClick: newPattern },
    { label: t('Rename pattern'), icon: 'Pencil', onClick: async () => {
      const v = await promptText(t('Rename pattern'), cur.name);
      if (v) store.change(() => { cur.name = v; });
    } },
    { label: t('Clone pattern'), icon: 'Copy', onClick: () => store.change((pp) => {
      const copy = JSON.parse(serialize(cur));
      const fresh = makePattern(nextPatternIndex(pp));
      copy.id = fresh.id;
      copy.name = cur.name + t(' copy');
      copy.color = fresh.color;
      pp.patterns.splice(pp.patterns.indexOf(cur) + 1, 0, copy);
      pp.currentPattern = copy.id;
    }) },
    { label: t('Delete pattern'), icon: 'Trash', disabled: p.patterns.length < 2, onClick: async () => {
      if (!(await confirmBox(t('Delete pattern'), t('Pattern “') + cur.name + t('” and its playlist clips will be deleted.'), t('Delete')))) return;
      store.change((pp) => {
        const i = pp.patterns.indexOf(cur);
        pp.patterns.splice(i, 1);
        pp.playlist.clips = pp.playlist.clips.filter((c) => c.patternId !== cur.id);
        pp.currentPattern = pp.patterns[Math.max(0, i - 1)].id;
      });
    } },
  ]);
}

function fmtTime(t) {
  const bar = Math.floor(t / BAR) + 1;
  const step = Math.floor((t % BAR) / STEP) + 1;
  const tick = Math.floor(t % STEP);
  return bar + ':' + String(step).padStart(2, '0') + ':' + String(tick).padStart(2, '0');
}

function refreshToolbar() {
  const p = store.project;
  patBtn.classList.toggle('on', !ui.songMode);
  songBtn.classList.toggle('on', ui.songMode);
  playBtn.replaceChildren(icon(engine.playing ? 'Pause' : 'Play'));
  playBtn.classList.toggle('on', engine.playing);
  metroBtn.classList.toggle('on', ui.metronome);
  recBtn.classList.toggle('on', ui.recording);
  tempoVal.textContent = p.bpm.toFixed(3);
  patName.textContent = currentPattern(p).name;
  timeVal.textContent = fmtTime(engine.position());
  undoBtn.disabled = !store.undoStack.length;
  redoBtn.disabled = !store.redoStack.length;
}

// Project menu
async function saveAs() {
  const v = await promptText(t('Project name'), store.project.name === t('Untitled') ? '' : store.project.name);
  if (!v) return false;
  if (v !== store.project.name && listProjects().some((x) => x.name === v)) {
    if (!(await confirmBox(t('Replace'), t('A project named “') + v + t('” already exists on this device. Replace it?'), t('Replace')))) return false;
  }
  store.project.name = v;
  return doSave();
}

function doSave() {
  try {
    saveProject(store.project);
    hint(t('Project saved: ') + store.project.name);
    sidebar.refresh();
    store.emit();
    return true;
  } catch {
    alertBox(t('Could not save'), t('The app storage is full. Delete old projects in the browser.'));
    return false;
  }
}

async function save() {
  if (store.project.name === t('Untitled')) return saveAs();
  return doSave();
}

async function newProj() {
  if (!(await confirmBox(t('New project'), t('The current project will be closed. Save it first if needed.'), t('New project')))) return;
  engine.stop();
  store.load(newProject());
  ui.prChannel = null;
  hint(t('New project'));
}

function openProjectDialog() {
  const list = listProjects();
  if (!list.length) {
    alertBox(t('Open'), t('No project saved on this device.'));
    return;
  }
  const m = openModal({
    title: t('Open a project'),
    body: h('div', { class: 'plist' }, list.map((pr) =>
      h('button', { class: 'brow-name', type: 'button', onClick: () => { m.close(); actions.openProject(pr.name); } }, icon('FileText', 14), pr.name,
        h('span', { class: 'brow-date' }, new Date(pr.savedAt).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' }))),
    )),
    actions: [{ label: t('Cancel') }],
  });
}

async function exportProject() {
  const name = (store.project.name || 'project').replace(/[\\/:*?"<>|]/g, '_') + '.astudio';
  try {
    await saveFile(name, serialize(store.project), 'application/json');
  } catch (e) {
    alertBox(t('Export failed'), String(e.message || e));
  }
}

async function importProject() {
  const text = await pickFile();
  if (!text) return;
  try {
    const p = normalizeProject(JSON.parse(text));
    engine.stop();
    store.load(p);
    hint(t('Project imported: ') + p.name);
  } catch {
    alertBox(t('Import failed'), t('This file is not a valid A Studio project.'));
  }
}

async function exportMidi() {
  const mode = ui.songMode ? 'song' : 'pattern';
  if (mode === 'song' && !store.project.playlist.clips.length) {
    alertBox(t('Export MIDI'), t('The playlist is empty. Place patterns in the playlist, or switch to PAT mode to export the current pattern.'));
    return;
  }
  try {
    const data = encodeMidi(store.project, mode);
    const base = (store.project.name || 'export').replace(/[\\/:*?"<>|]/g, '_');
    await saveFile(base + '.mid', data.buffer, 'audio/midi');
  } catch (e) {
    alertBox(t('Export failed'), String(e.message || e));
  }
}

async function exportWav() {
  const mode = ui.songMode ? 'song' : 'pattern';
  if (mode === 'song' && !store.project.playlist.clips.length) {
    alertBox('Export WAV', t('The playlist is empty. Place patterns in the playlist, or switch to PAT mode to export the current pattern.'));
    return;
  }
  const m = openModal({ title: 'Export WAV', body: h('p', null, t('Rendering...')), actions: [] });
  try {
    const wav = await renderWav(store.project, mode);
    m.close();
    const base = (store.project.name || 'export').replace(/[\\/:*?"<>|]/g, '_');
    await saveFile(base + '.wav', wav, 'audio/wav');
  } catch (e) {
    m.close();
    alertBox(t('Export failed'), String(e.message || e));
  }
}

const LEGAL = {
  privacy: { en: 'privacy', fr: 'fr/confidentialite' },
  terms: { en: 'terms', fr: 'fr/conditions' },
  cookies: { en: 'cookies', fr: 'fr/cookies' },
};
function openLegal(page, title) {
  const frame = h('iframe', { class: 'legal-frame', src: 'legal/' + LEGAL[page][lang === 'fr' ? 'fr' : 'en'] + '.html', title });
  openModal({ title, body: frame, wide: true, actions: [] });
}

function about() {
  openModal({
    title: t('About'),
    body: h('div', { class: 'about' },
      h('p', null, h('strong', null, 'A Studio'), t(' version ') + APP_VERSION),
      h('p', null, t('Music production studio for Android. Built in sounds are synthesized in real time.')),
      h('p', null, t('Your projects stay on this device. The app collects no data. Its only connection checks GitHub for a new version and can be turned off in Settings.')),
      h('p', null, t('Free software under the MIT license. A Studio is an independent project, not affiliated with Image Line or FL Studio.')),
      h('p', null, t('Icons: Lucide (ISC license).')),
    ),
  });
}

function mainMenu(anchor) {
  openMenu(anchor, [
    { label: t('New project'), icon: 'FilePlus', onClick: newProj },
    { label: t('Open'), icon: 'FolderOpen', onClick: openProjectDialog },
    { label: t('Save'), icon: 'Save', onClick: save },
    { label: t('Save as'), icon: 'Save', onClick: saveAs },
    { sep: true },
    { label: t('Import project file'), icon: 'Upload', onClick: importProject },
    { label: t('Export project file'), icon: 'Share2', onClick: exportProject },
    { label: ui.songMode ? t('Export song as WAV') : t('Export pattern as WAV'), icon: 'Download', onClick: exportWav },
    { label: ui.songMode ? t('Export song as MIDI') : t('Export pattern as MIDI'), icon: 'FileMusic', onClick: exportMidi },
    { sep: true },
    { label: t('Settings'), icon: 'Settings', onClick: () => openSettings({ onExtensionsChange: extensionsChanged, engine }) },
    { label: t('Plugins and themes'), icon: 'Puzzle', onClick: () => openSettings({ section: 'extensions', onExtensionsChange: extensionsChanged, engine }) },
    ...(updatesSupported() ? [{ label: t('Check for updates'), icon: 'Download', onClick: () => checkForUpdate({ silent: false }) }] : []),
    { sep: true },
    ...(extHost.menuItems().length ? [{ sep: true }, ...extHost.menuItems().map((m) => ({ label: m.label, icon: m.icon || 'Puzzle', onClick: m.onClick }))] : []),
    { sep: true },
    { label: t('Documentation'), icon: 'BookOpen', onClick: () => openExternal(DOCS_URL) },
    { label: t('Report a bug'), icon: 'Bug', onClick: () => openExternal(bugReportUrl()) },
    { label: t('Request a feature'), icon: 'Lightbulb', onClick: () => openExternal(featureRequestUrl()) },
    { sep: true },
    { label: t('Privacy'), icon: 'Shield', onClick: () => openLegal('privacy', t('Privacy policy')) },
    { label: t('Terms of use'), icon: 'FileText', onClick: () => openLegal('terms', t('Terms of use')) },
    { label: 'Cookies', icon: 'Cookie', onClick: () => openLegal('cookies', t('Cookie policy')) },
    { label: t('About'), icon: 'Info', onClick: about },
  ]);
}

// A theme or plugin was installed, removed or selected.
function extensionsChanged() {
  sidebar.refresh();
  extHost.reload();
  engine.preloadPlugins();
  dirty = true;
  for (const p of Object.values(panels)) if (p.redrawMinis) p.redrawMinis();
}

// Render loop
let dirty = true;
let projectEventTimer = null;
store.subscribe(() => {
  dirty = true;
  engine.sync();
  scheduleSave();
  preloadSamples();
  // Tell extensions that the project changed (at most a few times per second).
  clearTimeout(projectEventTimer);
  projectEventTimer = setTimeout(() => extHost.broadcastProject(extActions.projectSummary()), 250);
});

// Decode the samples used by the project so they play from the first note.
function preloadSamples() {
  const p = store.project;
  for (const c of p.channels) if (c.instrument === 'sampler' && c.sample && getSampleMeta(c.sample) && !getBuffer(c.sample)) loadBuffer(c.sample);
  for (const c of p.playlist.clips) if (c.type === 'audio' && getSampleMeta(c.sampleId) && !getBuffer(c.sampleId)) loadBuffer(c.sampleId);
}
onSamplesChange(() => {
  dirty = true;
  preloadSamples();
});
initSamples();

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveCurrent(store.project), 600);
}
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveCurrent(store.project);
});

let lastTime = '';
let lastState = '';
let lastStateAt = 0;
function frame() {
  const now = performance.now();
  if (now - lastStateAt > 150) {
    lastStateAt = now;
    const st = extState();
    const json = JSON.stringify(st);
    if (json !== lastState) {
      lastState = json;
      extHost.broadcast(st);
    }
  }
  if (dirty) {
    dirty = false;
    refreshToolbar();
    panels[ui.panel].update();
  }
  const p = panels[ui.panel];
  if (p.frame) p.frame();
  const t = fmtTime(engine.position());
  if (t !== lastTime) {
    lastTime = t;
    timeVal.textContent = t;
  }
  requestAnimationFrame(frame);
}

// Audio must start from a user gesture
window.addEventListener('pointerdown', () => engine.init(), { once: true, capture: true });

// Keyboard shortcuts (FL Studio layout where it makes sense)
window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (document.querySelector('.overlay')) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (e.key === ' ') togglePlay();
  else if (mod && k === 'z' && !e.shiftKey) store.undo();
  else if ((mod && k === 'y') || (mod && e.shiftKey && k === 'z')) store.redo();
  else if (mod && k === 's') save();
  else if (e.key === 'F5') showPanel('playlist');
  else if (e.key === 'F6') showPanel('rack');
  else if (e.key === 'F7') showPanel('piano');
  else if (e.key === 'F8') setSidebar(!ui.sidebar);
  else if (e.key === 'F9') showPanel('mixer');
  else if (k === 'l' && !mod) setSongMode(!ui.songMode);
  else if (ui.panel === 'piano' && panels.piano.keydown(e)) return;
  else {
    // Shortcuts added by extensions, only when the app does not use the key.
    const combo = (e.shiftKey ? 'shift+' : '') + (e.altKey ? 'alt+' : '') + k;
    const sc = !mod && extHost.shortcuts().find((x) => x.key === combo);
    if (!sc) return;
    sc.onClick();
  }
  e.preventDefault();
  closeMenu();
});

showPanel('rack');
extHost.reload();
requestAnimationFrame(frame);

if (updatesSupported() && autoCheckEnabled()) setTimeout(() => checkForUpdate({ silent: true }), 3000);
