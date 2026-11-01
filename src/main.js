import './style.css';
import { h, btn, icon, hint, bindHint, openMenu, openModal, promptText, confirmBox, alertBox, closeMenu } from './ui/dom.js';
import { store, newProject, currentPattern, makePattern, nextPatternIndex, serialize, normalizeProject } from './store.js';
import { ui } from './ui-state.js';
import { Engine, renderWav } from './audio/engine.js';
import { createRack } from './ui/rack.js';
import { createPianoRoll } from './ui/pianoroll.js';
import { createPlaylist } from './ui/playlist.js';
import { createMixer } from './ui/mixer.js';
import { createBrowser } from './ui/browser.js';
import { openChannelSettings } from './ui/channelSettings.js';
import { loadCurrent, saveCurrent, saveProject, loadProject, listProjects } from './persist.js';
import { saveFile, pickFile } from './platform.js';
import { BAR, STEP, clamp } from './constants.js';
import { APP_VERSION } from './version.js';
import { checkForUpdate, updatesSupported, autoCheckEnabled, setAutoCheck } from './update.js';

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
      hint('Projet ouvert : ' + store.project.name);
    } catch (e) {
      alertBox('Ouverture impossible', String(e.message || e));
    }
  },
};

const panels = {
  rack: createRack(engine, actions),
  piano: createPianoRoll(engine),
  playlist: createPlaylist(engine, actions),
  mixer: createMixer(engine),
  browser: createBrowser(engine, actions),
};

// Toolbar
const hintEl = h('div', { class: 'hint', 'aria-live': 'polite' });
bindHint(hintEl);

const patBtn = h('button', { class: 'b tb seg', type: 'button', onClick: () => setSongMode(false) }, 'PAT');
const songBtn = h('button', { class: 'b tb seg', type: 'button', onClick: () => setSongMode(true) }, 'SONG');
const playBtn = btn('Play', 'Lecture / pause (espace)', () => togglePlay(), 'play');
const stopBtn = btn('Square', 'Stop', () => stop(), 'stop');
const metroBtn = btn('Metronome', 'Métronome', () => {
  ui.metronome = !ui.metronome;
  hint('Métronome ' + (ui.metronome ? 'activé' : 'désactivé'));
  refreshToolbar();
});
const tempoVal = h('div', { class: 'lcd tempo', title: 'Tempo : glissez verticalement, double tap pour saisir' });
const timeVal = h('div', { class: 'lcd time', title: 'Position mesure:pas:tick' });
const patName = h('button', { class: 'b tb patname', type: 'button', title: 'Motifs', onClick: (e) => patternMenu(e.currentTarget) });
const undoBtn = btn('Undo2', 'Annuler', () => { if (store.undo()) hint('Annulé'); });
const redoBtn = btn('Redo2', 'Rétablir', () => { if (store.redo()) hint('Rétabli'); });

const topbar = h('header', { class: 'topbar' },
  btn('Menu', 'Menu', (e) => mainMenu(e.currentTarget)),
  h('div', { class: 'brand' }, 'A STUDIO'),
  h('div', { class: 'tgrp segs' }, patBtn, songBtn),
  h('div', { class: 'tgrp' }, playBtn, stopBtn, metroBtn),
  h('div', { class: 'tgrp tempo-grp' },
    btn('Minus', 'Tempo moins', () => setBpm(Math.round(store.project.bpm) - 1), 'small'),
    tempoVal,
    btn('Plus', 'Tempo plus', () => setBpm(Math.round(store.project.bpm) + 1), 'small'),
  ),
  timeVal,
  h('div', { class: 'tgrp' },
    btn('ChevronLeft', 'Motif précédent', () => stepPattern(-1), 'small'),
    patName,
    btn('ChevronRight', 'Motif suivant', () => stepPattern(1), 'small'),
  ),
  h('div', { class: 'tgrp' }, undoBtn, redoBtn),
  hintEl,
);

const railDefs = [
  ['playlist', 'LayoutList', 'Playlist'],
  ['rack', 'Grid3x3', 'Channel rack'],
  ['piano', 'Piano', 'Piano roll'],
  ['mixer', 'SlidersVertical', 'Mixer'],
  ['browser', 'FolderOpen', 'Navigateur'],
];
const railBtns = railDefs.map(([id, ic, label]) => {
  const b = h('button', { class: 'rail-btn', type: 'button', title: label, 'aria-label': label, onClick: () => showPanel(id) }, icon(ic, 20), h('span', null, label.split(' ')[0]));
  b.dataset.panel = id;
  return b;
});
const rail = h('nav', { class: 'rail' }, railBtns);
const stage = h('main', { class: 'stage' }, Object.values(panels).map((p) => p.el));
document.getElementById('app').append(topbar, h('div', { class: 'body' }, rail, stage));

function showPanel(id) {
  ui.panel = id;
  for (const [k, p] of Object.entries(panels)) p.el.classList.toggle('active', k === id);
  railBtns.forEach((b) => b.classList.toggle('on', b.dataset.panel === id));
  panels[id].update();
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
    hint('Tempo : ' + store.project.bpm + ' BPM');
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
  hint('Tempo : ' + n + ' BPM');
}

function setSongMode(on) {
  if (ui.songMode === on) return;
  const was = engine.playing;
  engine.stop();
  ui.songMode = on;
  if (was) engine.play();
  hint(on ? 'Mode morceau : lecture de la playlist' : 'Mode motif : lecture du motif courant');
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
  hint('Nouveau motif : ' + currentPattern(store.project).name);
}

function patternMenu(anchor) {
  const p = store.project;
  const cur = currentPattern(p);
  openMenu(anchor, [
    ...p.patterns.map((pt) => ({ label: pt.name, checked: pt.id === p.currentPattern, onClick: () => { p.currentPattern = pt.id; store.emit(); } })),
    { sep: true },
    { label: 'Nouveau motif', icon: 'Plus', onClick: newPattern },
    { label: 'Renommer le motif', icon: 'Pencil', onClick: async () => {
      const v = await promptText('Renommer le motif', cur.name);
      if (v) store.change(() => { cur.name = v; });
    } },
    { label: 'Cloner le motif', icon: 'Copy', onClick: () => store.change((pp) => {
      const copy = JSON.parse(serialize(cur));
      const fresh = makePattern(nextPatternIndex(pp));
      copy.id = fresh.id;
      copy.name = cur.name + ' copie';
      copy.color = fresh.color;
      pp.patterns.splice(pp.patterns.indexOf(cur) + 1, 0, copy);
      pp.currentPattern = copy.id;
    }) },
    { label: 'Supprimer le motif', icon: 'Trash', disabled: p.patterns.length < 2, onClick: async () => {
      if (!(await confirmBox('Supprimer le motif', 'Le motif « ' + cur.name + ' » et ses clips dans la playlist seront supprimés.', 'Supprimer'))) return;
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
  tempoVal.textContent = p.bpm.toFixed(3);
  patName.textContent = currentPattern(p).name;
  timeVal.textContent = fmtTime(engine.position());
  undoBtn.disabled = !store.undoStack.length;
  redoBtn.disabled = !store.redoStack.length;
}

// Project menu
async function saveAs() {
  const v = await promptText('Nom du projet', store.project.name === 'Sans titre' ? '' : store.project.name);
  if (!v) return false;
  if (v !== store.project.name && listProjects().some((x) => x.name === v)) {
    if (!(await confirmBox('Remplacer', 'Un projet nommé « ' + v + ' » existe déjà sur cet appareil. Le remplacer ?', 'Remplacer'))) return false;
  }
  store.project.name = v;
  return doSave();
}

function doSave() {
  try {
    saveProject(store.project);
    hint('Projet enregistré : ' + store.project.name);
    panels.browser.refresh();
    store.emit();
    return true;
  } catch {
    alertBox('Enregistrement impossible', 'L’espace de stockage de l’application est plein. Supprimez d’anciens projets dans le navigateur.');
    return false;
  }
}

async function save() {
  if (store.project.name === 'Sans titre') return saveAs();
  return doSave();
}

async function newProj() {
  if (!(await confirmBox('Nouveau projet', 'Le projet en cours sera fermé. Pensez à l’enregistrer avant.', 'Nouveau projet'))) return;
  engine.stop();
  store.load(newProject());
  ui.prChannel = null;
  hint('Nouveau projet');
}

function openProjectDialog() {
  const list = listProjects();
  if (!list.length) {
    alertBox('Ouvrir', 'Aucun projet enregistré sur cet appareil.');
    return;
  }
  const m = openModal({
    title: 'Ouvrir un projet',
    body: h('div', { class: 'plist' }, list.map((pr) =>
      h('button', { class: 'brow-name', type: 'button', onClick: () => { m.close(); actions.openProject(pr.name); } }, icon('FileText', 14), pr.name,
        h('span', { class: 'brow-date' }, new Date(pr.savedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))),
    )),
    actions: [{ label: 'Annuler' }],
  });
}

async function exportProject() {
  const name = (store.project.name || 'projet').replace(/[\\/:*?"<>|]/g, '_') + '.astudio';
  try {
    await saveFile(name, serialize(store.project), 'application/json');
  } catch (e) {
    alertBox('Export impossible', String(e.message || e));
  }
}

async function importProject() {
  const text = await pickFile();
  if (!text) return;
  try {
    const p = normalizeProject(JSON.parse(text));
    engine.stop();
    store.load(p);
    hint('Projet importé : ' + p.name);
  } catch {
    alertBox('Import impossible', 'Ce fichier n’est pas un projet A Studio valide.');
  }
}

async function exportWav() {
  const mode = ui.songMode ? 'song' : 'pattern';
  if (mode === 'song' && !store.project.playlist.clips.length) {
    alertBox('Export WAV', 'La playlist est vide. Placez des motifs dans la playlist, ou passez en mode PAT pour exporter le motif courant.');
    return;
  }
  const m = openModal({ title: 'Export WAV', body: h('p', null, 'Rendu en cours...'), actions: [] });
  try {
    const wav = await renderWav(store.project, mode);
    m.close();
    const base = (store.project.name || 'export').replace(/[\\/:*?"<>|]/g, '_');
    await saveFile(base + '.wav', wav, 'audio/wav');
  } catch (e) {
    m.close();
    alertBox('Export impossible', String(e.message || e));
  }
}

function openLegal(page, title) {
  const frame = h('iframe', { class: 'legal-frame', src: 'legal/' + page + '.html', title });
  openModal({ title, body: frame, wide: true, actions: [] });
}

function about() {
  openModal({
    title: 'À propos',
    body: h('div', { class: 'about' },
      h('p', null, h('strong', null, 'A Studio'), ' version ' + APP_VERSION),
      h('p', null, 'Station de création musicale pour Android. Les sons sont produits par synthèse en temps réel, sans échantillons.'),
      h('p', null, 'Vos projets restent sur cet appareil. L’application ne collecte aucune donnée. Sa seule connexion sert à vérifier sur GitHub si une nouvelle version existe, et elle peut être désactivée dans le menu.'),
      h('p', null, 'Logiciel libre sous licence MIT. A Studio est un projet indépendant, sans lien avec Image Line ni avec FL Studio.'),
      h('p', null, 'Icônes : Lucide (licence ISC).'),
    ),
  });
}

function mainMenu(anchor) {
  openMenu(anchor, [
    { label: 'Nouveau projet', icon: 'FilePlus', onClick: newProj },
    { label: 'Ouvrir', icon: 'FolderOpen', onClick: openProjectDialog },
    { label: 'Enregistrer', icon: 'Save', onClick: save },
    { label: 'Enregistrer sous', icon: 'Save', onClick: saveAs },
    { sep: true },
    { label: 'Importer un fichier projet', icon: 'Upload', onClick: importProject },
    { label: 'Exporter le fichier projet', icon: 'Share2', onClick: exportProject },
    { label: ui.songMode ? 'Exporter le morceau en WAV' : 'Exporter le motif en WAV', icon: 'Download', onClick: exportWav },
    ...(updatesSupported()
      ? [
          { sep: true },
          { label: 'Rechercher une mise à jour', icon: 'Download', onClick: () => checkForUpdate({ silent: false }) },
          { label: 'Vérifier au démarrage', checked: autoCheckEnabled(), onClick: () => {
            setAutoCheck(!autoCheckEnabled());
            hint(autoCheckEnabled() ? 'Vérification au démarrage activée' : 'Vérification au démarrage désactivée');
          } },
        ]
      : []),
    { sep: true },
    { label: 'Confidentialité', icon: 'Shield', onClick: () => openLegal('confidentialite', 'Politique de confidentialité') },
    { label: 'Conditions d’utilisation', icon: 'FileText', onClick: () => openLegal('conditions', 'Conditions d’utilisation') },
    { label: 'Cookies', icon: 'Cookie', onClick: () => openLegal('cookies', 'Politique des cookies') },
    { label: 'À propos', icon: 'Info', onClick: about },
  ]);
}

// Render loop
let dirty = true;
store.subscribe(() => {
  dirty = true;
  engine.sync();
  scheduleSave();
});

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveCurrent(store.project), 600);
}
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveCurrent(store.project);
});

let lastTime = '';
function frame() {
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
  else if (e.key === 'F8') showPanel('browser');
  else if (e.key === 'F9') showPanel('mixer');
  else if (k === 'l' && !mod) setSongMode(!ui.songMode);
  else if (ui.panel === 'piano' && panels.piano.keydown(e)) return;
  else return;
  e.preventDefault();
  closeMenu();
});

showPanel('rack');
requestAnimationFrame(frame);

if (updatesSupported() && autoCheckEnabled()) setTimeout(() => checkForUpdate({ silent: true }), 3000);
