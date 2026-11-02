import './style.css';
import { h, btn, icon, hint, bindHint, openMenu, openModal, promptText, confirmBox, alertBox, closeMenu, dropdown } from './ui/dom.js';
import { store, newProject, currentPattern, makePattern, nextPatternIndex, serialize, normalizeProject, notesFor, newId } from './store.js';
import { ui } from './ui-state.js';
import { Engine, renderWav, renderStems, renderChannels } from './audio/engine.js';
import { encodeMp3 } from './mp3.js';
import { decodeMidi, importMidi } from './midiimport.js';
import { initMidi, midiEnabled } from './midiin.js';
import { micSupported, startMic, stopMic, micRecording, startMonitor, openAnalyser } from './recorder.js';
import { VOCAL_CHAINS, chainSlots, noteOfFreq, detectPitch, projectKey } from './vocal.js';
import { TEMPLATES } from './templates.js';
import { TIME_SIGS } from './constants.js';
import { pickBinary } from './platform.js';
import { exportProjectZip, importProjectZip } from './projectzip.js';
import { listBackups, maybeBackup } from './backups.js';
import { openGuide, guideSeen } from './ui/guide.js';
import { zipSync } from 'fflate';
import { createRack } from './ui/rack.js';
import { createPianoRoll } from './ui/pianoroll.js';
import { createPlaylist } from './ui/playlist.js';
import { createMixer } from './ui/mixer.js';
import { createLive } from './ui/live.js';
import { createSidebar } from './ui/sidebar.js';
import { addSampler } from './ui/rack.js';
import { initSamples, onSamplesChange, getSampleMeta, getBuffer, loadBuffer } from './samples.js';
import { openChannelSettings } from './ui/channelSettings.js';
import { loadCurrent, saveCurrent, saveProject, loadProject, listProjects } from './persist.js';
import { saveFile } from './platform.js';
import { BAR, STEP, NKEYS, TRACKS, clamp } from './constants.js';
import { createExtensionHost } from './extensions.js';
import { isInstrumentId, CATALOG } from './audio/catalog.js';
import { pluginInstruments, getPlugin } from './plugins.js';
import { createChannel } from './ui/rack.js';
import { encodeMidi } from './midi.js';
import { APP_VERSION } from './version.js';
import { checkForUpdate, updatesSupported, autoCheckEnabled, applyOrientation } from './update.js';
import { t, locale, lang } from './i18n.js';
import { initTheme } from './themes.js';
import { openSettings, refreshOpenSettings } from './ui/settings.js';
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

const engine = new Engine(store, () => (ui.live ? 'live' : ui.songMode ? 'song' : 'pattern'), () => ui.metronome);
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
  live: createLive(engine, { modeChanged: () => refreshToolbar(), stop: () => stop() }),
  mixer: createMixer(engine, () => openSettings({ section: 'extensions', onExtensionsChange: extensionsChanged, engine, extHost })),
};
const sidebar = createSidebar(engine, actions);

// Toolbar
const hintEl = h('div', { class: 'hint', 'aria-live': 'polite' });
bindHint(hintEl);

const patBtn = h('button', { class: 'b tb seg', type: 'button', onClick: () => setSongMode(false) }, 'PAT');
const songBtn = h('button', { class: 'b tb seg', type: 'button', onClick: () => setSongMode(true) }, 'SONG');
const playBtn = btn('Play', t('Play / pause (space)'), () => togglePlay(), 'play');
const stopBtn = btn('Square', 'Stop', () => stop(), 'stop');
const pref = (k, d) => {
  try {
    const v = localStorage.getItem('astudio:' + k);
    return v == null ? d : v;
  } catch {
    return d;
  }
};
const setPref = (k, v) => {
  try {
    localStorage.setItem('astudio:' + k, String(v));
  } catch {
    /* ignore */
  }
};
ui.countIn = pref('countin', '0') === '1';
ui.monitor = pref('monitor', '0') === '1';
ui.recInsert = Number(pref('recinsert', '0')) || 0;
engine.metroVol = Number(pref('metrovol', '0.5'));
if (!Number.isFinite(engine.metroVol)) engine.metroVol = 0.5;
const recBtn = btn('Circle', t('Record'), (e) => recordMenu(e.currentTarget), 'rec');
function recordMenu(anchor) {
  if (micRecording()) return stop();
  openMenu(anchor, [
    { header: t('Record') },
    { label: t('Notes (piano roll keyboard and MIDI keyboard)'), icon: 'Piano', checked: ui.recording, onClick: () => {
      ui.recording = !ui.recording;
      hint(ui.recording ? t('Recording armed: play the pattern and use the piano roll keyboard') : t('Recording off'));
      refreshToolbar();
    } },
    { label: t('Audio from the microphone into the playlist'), icon: 'Mic', disabled: !micSupported(), onClick: () => recordAudio() },
    { sep: true },
    { header: t('Voice') },
    { label: t('Vocal insert: ') + (ui.recInsert ? ui.recInsert + ' ' + store.project.mixer[ui.recInsert].name : 'Master') + '...', icon: 'SlidersVertical', onClick: () => openMenu(anchor, [
      { header: t('Takes play through this mixer insert') },
      ...store.project.mixer.map((m, i) => ({ label: i === 0 ? 'Master' : i + '  ' + m.name, checked: ui.recInsert === i, onClick: () => { ui.recInsert = i; setPref('recinsert', i); } })),
    ]) },
    { label: t('Set up a vocal insert with effects') + '...', icon: 'Mic', onClick: () => openMenu(anchor, [
      { header: t('Uses a free insert and loads a vocal chain') },
      ...VOCAL_CHAINS.map((c) => ({ label: t(c.name), onClick: () => setupVocalInsert(c) })),
    ]) },
    { label: t('Hear the microphone with the effects (headphones)'), icon: 'Headphones', checked: ui.monitor, disabled: !micSupported(), onClick: () => toggleMonitor() },
    { label: t('Tuner'), icon: 'Music', disabled: !micSupported(), onClick: () => openTuner() },
    { label: t('Lyrics on screen'), icon: 'NotebookPen', checked: !!lyricsEl, onClick: () => toggleLyrics() },
    { sep: true },
    { label: t('Count in one bar before recording'), icon: 'Metronome', checked: ui.countIn, onClick: () => {
      ui.countIn = !ui.countIn;
      setPref('countin', ui.countIn ? '1' : '0');
    } },
  ]);
}

// A free insert named Vocals with a ready chain; recordings will play through it.
function setupVocalInsert(chain) {
  const p = store.project;
  const used = new Set([...p.channels.map((c) => c.insert), ...p.playlist.tracks.map((tr) => tr.insert || 0)]);
  let idx = ui.recInsert && p.mixer[ui.recInsert].name === 'Vocals' ? ui.recInsert : 0;
  for (let i = p.mixer.length - 1; !idx && i > 0; i--) if (!used.has(i)) idx = i;
  if (!idx) return alertBox(t('Vocal insert'), t('Every mixer insert is in use.'));
  store.change((pp) => {
    pp.mixer[idx].name = 'Vocals';
    pp.mixer[idx].fx = chainSlots(chain);
    // Auto tune follows the project scale, or the key found in the notes.
    let sc = pp.scale && pp.scale.type !== 'none' ? pp.scale : null;
    if (!sc) {
      const k = projectKey(pp);
      if (k) sc = { root: k.root, type: k.type };
    }
    if (sc) {
      const map = { major: 1, minor: 2, harmonic: 3, pentaMajor: 4, pentaMinor: 5, blues: 6 };
      for (const f of pp.mixer[idx].fx) if (f.plugin === 'astudio-autotune') {
        f.params.key = sc.root;
        if (map[sc.type] != null) f.params.scale = map[sc.type];
      }
    }
  });
  ui.recInsert = idx;
  setPref('recinsert', idx);
  if (ui.monitor) restartMonitor();
  hint(t('Insert ') + idx + ' Vocals: ' + t(chain.name) + '. ' + t('Takes play through it.'));
}

// Live monitoring of the microphone through the vocal insert.
let monitorStop = null;
async function restartMonitor() {
  if (monitorStop) monitorStop();
  monitorStop = null;
  if (!ui.monitor) return;
  engine.init();
  try {
    monitorStop = await startMonitor(engine.ctx, (engine.G.inserts[ui.recInsert] || engine.G.inserts[0]).in);
  } catch (e) {
    ui.monitor = false;
    setPref('monitor', '0');
    alertBox(t('Microphone'), t('The microphone could not be opened. Allow A Studio to use it in the system settings. ') + String((e && e.message) || ''));
  }
}
function toggleMonitor() {
  ui.monitor = !ui.monitor;
  setPref('monitor', ui.monitor ? '1' : '0');
  restartMonitor();
  hint(ui.monitor ? t('Microphone on: you hear your voice through the vocal insert. Use headphones.') : t('Microphone off'));
}

// Lyrics panel: stays on screen (not a dialog) so Play, Record and Stop keep working.
let lyricsEl = null;
function toggleLyrics() {
  if (lyricsEl) {
    lyricsEl.remove();
    lyricsEl = null;
    return;
  }
  const area = h('textarea', { class: 'lyrics-text', placeholder: t('Write or paste your lyrics here. They are saved in the project notes.'), 'aria-label': t('Lyrics') });
  area.value = store.project.notes || '';
  area.addEventListener('input', () => {
    store.project.notes = area.value.slice(0, 2000);
    scheduleSave();
  });
  let size = Number(pref('lyricsize', '18')) || 18;
  const applySize = () => { area.style.fontSize = size + 'px'; };
  applySize();
  lyricsEl = h('div', { class: 'lyrics' },
    h('div', { class: 'lyrics-head' },
      icon('NotebookPen', 16), h('span', null, t('Lyrics')),
      btn('Minus', t('Smaller text'), () => { size = Math.max(12, size - 2); setPref('lyricsize', size); applySize(); }, 'small'),
      btn('Plus', t('Bigger text'), () => { size = Math.min(40, size + 2); setPref('lyricsize', size); applySize(); }, 'small'),
      btn('X', t('Close'), () => toggleLyrics(), 'small'),
    ),
    area,
  );
  document.body.append(lyricsEl);
}

// Tuner: shows the note sung or played into the microphone.
async function openTuner() {
  engine.init();
  let an;
  try {
    an = await openAnalyser(engine.ctx);
  } catch (e) {
    alertBox(t('Microphone'), t('The microphone could not be opened. Allow A Studio to use it in the system settings. ') + String((e && e.message) || ''));
    return;
  }
  const note = h('div', { class: 'tuner-note' }, '...');
  const cents = h('div', { class: 'tuner-cents' });
  const needle = h('div', { class: 'tuner-needle' });
  const meter = h('div', { class: 'tuner-meter' }, h('i', { class: 'tuner-mid' }), needle);
  const buf = new Float32Array(an.analyser.fftSize);
  let alive = true;
  const loop = () => {
    if (!alive) return;
    an.analyser.getFloatTimeDomainData(buf);
    const nf = noteOfFreq(detectPitch(buf, engine.ctx.sampleRate));
    if (nf) {
      note.textContent = nf.name;
      cents.textContent = (nf.cents > 0 ? '+' : '') + nf.cents + ' cents';
      needle.style.left = 50 + nf.cents + '%';
      needle.classList.toggle('ok', Math.abs(nf.cents) <= 5);
    }
    setTimeout(loop, 60);
  };
  loop();
  openModal({
    title: t('Tuner'),
    body: h('div', { class: 'tuner' }, note, meter, cents, h('p', { class: 'set-note' }, t('Sing or play one note. Middle C is C5, like in the piano roll.'))),
    onClose: () => {
      alive = false;
      an.stop();
    },
  });
}

// Microphone take: the mic opens first, playback starts in SONG mode (after the
// count in), and Stop places the take as an audio clip on a free track.
let audioRec = null;
async function recordAudio() {
  if (!micSupported()) return;
  setSongMode(true);
  engine.init();
  try {
    await startMic();
  } catch (e) {
    alertBox(t('Microphone'), t('The microphone could not be opened. Allow A Studio to use it in the system settings. ') + String((e && e.message) || ''));
    return;
  }
  const micAt = engine.ctx.currentTime;
  if (ui.monitor && !monitorStop) restartMonitor();
  if (engine.playing) engine.pause();
  engine.play({ countIn: ui.countIn ? 1 : 0 });
  audioRec = { start: engine.startPos, lead: engine.startAt - micAt, bpm: engine.bpm };
  hint(t('Recording audio. Press Stop to finish.'));
  refreshToolbar();
}

async function finishAudioRecording() {
  const r = audioRec;
  audioRec = null;
  const spt = 60 / (r.bpm * 96);
  const playedTicks = Math.max(0, (engine.ctx.currentTime - (engine.startAt || 0)) / spt);
  const n = (store.project.playlist.clips.filter((c) => c.type === 'audio' && /^Take /.test(c.name || '')).length || 0) + 1;
  const name = 'Take ' + n;
  const res = await stopMic(name).catch(() => null);
  if (!res) {
    alertBox(t('Microphone'), t('Nothing was recorded.'));
    return;
  }
  const len = Math.max(STEP, Math.round(playedTicks));
  const p = store.project;
  const free = (i) => !p.playlist.clips.some((c) => c.track === i && c.start < r.start + len && c.start + (c.len || BAR) > r.start);
  // Prefer a free track that already plays through the vocal insert.
  let track = -1;
  for (let i = 0; i < TRACKS && track < 0; i++) if (free(i) && (p.playlist.tracks[i].insert || 0) === ui.recInsert && (ui.recInsert || !p.playlist.clips.some((c) => c.track === i))) track = i;
  for (let i = 0; i < TRACKS && track < 0; i++) if (free(i) && !p.playlist.clips.some((c) => c.track === i)) track = i;
  if (track < 0) track = 0;
  const lp = p.loop;
  // Lead before playback plus the measured recording latency (Settings).
  const latency = Math.max(0, Number(pref('latency', '0')) || 0) / 1000;
  const leadTicks = Math.max(0, Math.round((Math.max(0, r.lead) + latency) / spt));
  const firstLen = lp && lp.on ? lp.end - r.start : len;
  if (lp && lp.on && len > firstLen + BAR / 4) {
    // Loop recording: one take per pass of the loop, each on its own track; only the last one plays.
    const span = lp.end - lp.start;
    const passes = [{ start: r.start, len: firstLen, offset: leadTicks }];
    for (let done = firstLen; done < len - BAR / 4; done += span) passes.push({ start: lp.start, len: Math.min(span, len - done), offset: leadTicks + done });
    const tracks = [];
    for (let i = 0; i < TRACKS && tracks.length < passes.length; i++) if (!p.playlist.clips.some((c) => c.track === i)) tracks.push(i);
    store.change((pp) => {
      passes.forEach((ps, k) => {
        const tr = tracks[k] != null ? tracks[k] : track;
        if (ui.recInsert) pp.playlist.tracks[tr].insert = ui.recInsert;
        pp.playlist.tracks[tr].name = name + '.' + (k + 1);
        pp.playlist.tracks[tr].mute = k < passes.length - 1;
        pp.playlist.clips.push({ id: newId('k'), type: 'audio', sampleId: res.id, name: name + '.' + (k + 1), track: tr, start: Math.round(ps.start), len: Math.round(ps.len), offset: Math.round(ps.offset) });
      });
    });
    loadBuffer(res.id);
    hint(passes.length + t(' takes recorded. Only the last one plays: tap a track name to switch.'));
    return;
  }
  store.change((pp) => {
    if (ui.recInsert) pp.playlist.tracks[track].insert = ui.recInsert;
    pp.playlist.clips.push({ id: newId('k'), type: 'audio', sampleId: res.id, name, track, start: Math.round(r.start), len, ...(leadTicks ? { offset: leadTicks } : {}) });
  });
  loadBuffer(res.id);
  hint(name + t(' placed on ') + p.playlist.tracks[track].name);
}
const metroBtn = btn('Metronome', t('Metronome'), () => {
  ui.metronome = !ui.metronome;
  hint(t('Metronome ') + (ui.metronome ? t('on') : t('off')));
  refreshToolbar();
});
const tempoVal = h('div', { class: 'lcd tempo', title: t('Tempo: drag vertically, double tap to type') });
const timeVal = h('div', { class: 'lcd time', title: t('Position bar:step:tick') });
const cpuVal = h('div', { class: 'lcd cpu', title: t('Voices playing and scheduler load') }, '0 v');
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
    btn('Pointer', t('Tap tempo: tap in rhythm'), () => tapTempo(), 'small'),
  ),
  timeVal,
  cpuVal,
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
  ['live', 'LayoutGrid', 'Live'],
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
  // In portrait the browser covers the stage: picking a panel closes it.
  if (ui.sidebar && window.matchMedia && window.matchMedia('(orientation: portrait) and (max-width: 760px)').matches && typeof setSidebar === 'function') setSidebar(false);
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
    instruments() {
      return [
        ...CATALOG.map((i) => ({ id: i.id, name: i.name, category: i.cat })),
        ...pluginInstruments().map((p) => ({ id: 'plugin:' + p.id, name: p.name, category: p.category })),
      ];
    },
    addChannel(instrument, name) {
      if (!isInstrumentId(instrument) || instrument === 'sampler') throw new Error('Unknown instrument ' + instrument);
      if (instrument.startsWith('plugin:') && !getPlugin(instrument.slice(7))) throw new Error('Plugin not installed: ' + instrument);
      let c = null;
      store.change((p) => {
        c = createChannel(p, instrument);
        if (c && name) c.name = name;
      });
      if (!c) throw new Error('The channel rack is full');
      return { id: c.id, name: c.name, instrument: c.instrument };
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
    extensionSettingsChanged: () => refreshOpenSettings(),
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

// Tap tempo: the average of the last taps, reset after a 2 second pause.
const taps = [];
function tapTempo() {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
  taps.push(now);
  if (taps.length > 6) taps.shift();
  if (taps.length < 2) {
    hint(t('Tap again in rhythm'));
    return;
  }
  const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
  setBpm(Math.round(60000 / avg));
}

function setBpm(v) {
  const n = clamp(Math.round(v * 1000) / 1000, 10, 522);
  if (n === store.project.bpm) return;
  store.change((p) => { p.bpm = n; });
  hint(t('Tempo: ') + n + ' BPM');
}

function setSongMode(on) {
  if (ui.live) {
    ui.live = false;
    engine.stop();
    ui.songMode = !on;
  }
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
  if (!engine.playing && ui.recording && ui.countIn) engine.play({ countIn: 1 });
  else engine.togglePlay();
  refreshToolbar();
}

function stop() {
  const wasRecording = !!audioRec;
  if (wasRecording) finishAudioRecording();
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
  patBtn.classList.toggle('on', !ui.songMode && !ui.live);
  songBtn.classList.toggle('on', ui.songMode && !ui.live);
  playBtn.replaceChildren(icon(engine.playing ? 'Pause' : 'Play'));
  playBtn.classList.toggle('on', engine.playing);
  metroBtn.classList.toggle('on', ui.metronome);
  recBtn.classList.toggle('on', ui.recording || !!audioRec);
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

function newProj() {
  const m = openModal({
    title: t('New project'),
    body: h('div', { class: 'form' },
      h('p', { class: 'set-note' }, t('The current project will be closed. Save it first if needed.')),
      h('div', { class: 'plist' }, TEMPLATES.map((tp) => h('button', { class: 'brow-name', type: 'button', onClick: () => {
        m.close();
        maybeBackup(store.project, true);
        engine.stop();
        store.load(tp.make());
        ui.prChannel = null;
        hint(t('New project') + ': ' + t(tp.name));
      } }, icon(tp.id === 'empty' ? 'FilePlus' : 'Music', 14), t(tp.name)))),
    ),
    actions: [{ label: t('Cancel') }],
  });
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

// Accepts a .astudio file or a project ZIP with its samples.
async function importProject() {
  const f = await pickBinary('.astudio,.zip,application/json,application/zip');
  if (!f) return;
  try {
    let raw;
    let added = 0;
    if (f.bytes[0] === 0x50 && f.bytes[1] === 0x4b) ({ raw, added } = await importProjectZip(f.bytes));
    else raw = JSON.parse(new TextDecoder().decode(f.bytes));
    const p = normalizeProject(raw);
    maybeBackup(store.project, true);
    engine.stop();
    store.load(p);
    hint(t('Project imported: ') + p.name + (added ? ', ' + added + ' ' + t('samples') : ''));
  } catch {
    alertBox(t('Import failed'), t('This file is not a valid A Studio project.'));
  }
}

async function exportProjectWithSamples() {
  const m = openModal({ title: t('Export project with samples'), body: h('p', null, t('Packing...')), actions: [] });
  try {
    const zip = await exportProjectZip(store.project);
    m.close();
    const base = (store.project.name || 'project').replace(/[\\/:*?"<>|]/g, '_');
    await saveFile(base + '.zip', zip.buffer, 'application/zip');
  } catch (e) {
    m.close();
    alertBox(t('Export failed'), String(e.message || e));
  }
}

function restoreBackupDialog() {
  const list = listBackups().reverse();
  if (!list.length) return alertBox(t('Backups'), t('No backup yet. A backup is made every 5 minutes while you work.'));
  const m = openModal({
    title: t('Restore a backup'),
    body: h('div', { class: 'plist' },
      h('p', { class: 'set-note' }, t('The current project is backed up first, so you can come back to it.')),
      list.map((b) => h('button', { class: 'brow-name', type: 'button', onClick: () => {
        m.close();
        try {
          const p = normalizeProject(JSON.parse(b.data));
          maybeBackup(store.project, true);
          engine.stop();
          store.load(p);
          hint(t('Backup restored: ') + p.name);
        } catch {
          alertBox(t('Import failed'), t('This backup could not be read.'));
        }
      } }, icon('RefreshCw', 14), b.name, h('span', { class: 'brow-date' }, new Date(b.at).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' })))),
    ),
    actions: [{ label: t('Cancel') }],
  });
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

// Audio export: WAV 16 or 24 bit, or MP3, with optional normalization.
const EXPORT_FORMATS = [
  { id: 'wav16', label: 'WAV 16 bit' },
  { id: 'wav24', label: 'WAV 24 bit' },
  { id: 'mp3-192', label: 'MP3 192 kbps' },
  { id: 'mp3-320', label: 'MP3 320 kbps' },
];
let exportFormat = 'wav16';
let exportNormalize = false;
function exportWav() {
  const mode = ui.songMode ? 'song' : 'pattern';
  if (mode === 'song' && !store.project.playlist.clips.length) {
    alertBox(t('Export audio'), t('The playlist is empty. Place patterns in the playlist, or switch to PAT mode to export the current pattern.'));
    return;
  }
  const fmt = dropdown({ label: t('Format'), value: exportFormat, options: EXPORT_FORMATS.map((f) => ({ value: f.id, label: f.label })), onChange: (v) => { exportFormat = v; } });
  const norm = h('input', { type: 'checkbox', checked: exportNormalize, onChange: (e) => { exportNormalize = e.target.checked; } });
  openModal({
    title: mode === 'song' ? t('Export song') : t('Export pattern'),
    body: h('div', { class: 'form' },
      h('label', { class: 'field' }, h('span', null, t('Format')), fmt),
      h('label', { class: 'switch' }, norm, h('span', null, t('Normalize (peak at -0.3 dB)'))),
      h('p', { class: 'set-note' }, t('44.1 kHz stereo. MP3 encoding uses LAME (LGPL).')),
    ),
    actions: [{ label: t('Cancel') }, { label: t('Export'), primary: true, onClick: () => { doExport(mode); } }],
  });
}

async function doExport(mode) {
  const status = h('p', null, t('Rendering...'));
  const m = openModal({ title: t('Export audio'), body: status, actions: [] });
  const base = (store.project.name || 'export').replace(/[\\/:*?"<>|]/g, '_');
  try {
    if (exportFormat.startsWith('mp3')) {
      const { channels, sampleRate } = await renderChannels(store.project, mode, { normalize: exportNormalize });
      status.textContent = t('Encoding MP3...');
      const mp3 = await encodeMp3(channels, sampleRate, Number(exportFormat.split('-')[1]), (f) => { status.textContent = t('Encoding MP3...') + ' ' + Math.round(f * 100) + '%'; });
      m.close();
      await saveFile(base + '.mp3', mp3.buffer, 'audio/mpeg');
    } else {
      const wav = await renderWav(store.project, mode, { bits: exportFormat === 'wav24' ? 24 : 16, normalize: exportNormalize });
      m.close();
      await saveFile(base + '.wav', wav, 'audio/wav');
    }
  } catch (e) {
    m.close();
    alertBox(t('Export failed'), String(e.message || e));
  }
}

async function importMidiFile() {
  const f = await pickBinary('.mid,.midi,audio/midi');
  if (!f) return;
  let parsed;
  try {
    parsed = decodeMidi(f.bytes);
  } catch (e) {
    alertBox(t('Import failed'), t('This file is not a valid MIDI file.') + ' ' + String(e.message || ''));
    return;
  }
  if (!parsed.tracks.length) {
    alertBox(t('Import failed'), t('The MIDI file has no notes.'));
    return;
  }
  let res = null;
  store.change((p) => { res = importMidi(p, parsed, f.name.replace(/\.midi?$/i, '')); });
  hint(t('MIDI imported: ') + res.pattern.name + ', ' + res.channels + ' ' + t('channels'));
  showPanel('rack');
}

async function exportStems() {
  const mode = ui.songMode ? 'song' : 'pattern';
  if (mode === 'song' && !store.project.playlist.clips.length) {
    alertBox(t('Export stems'), t('The playlist is empty. Place patterns in the playlist, or switch to PAT mode to export the current pattern.'));
    return;
  }
  const status = h('p', null, t('Rendering...'));
  const m = openModal({ title: t('Export stems'), body: status, actions: [] });
  try {
    const stems = await renderStems(store.project, mode, (i, n, name) => { status.textContent = t('Rendering') + ' ' + (i + 1) + '/' + n + ': ' + name; }, { bits: exportFormat === 'wav24' ? 24 : 16 });
    if (!stems.length) {
      m.close();
      alertBox(t('Export stems'), t('No channel has notes to export.'));
      return;
    }
    const files = {};
    stems.forEach((st, i) => {
      const nm = String(i + 1).padStart(2, '0') + ' ' + st.name.replace(/[\\/:*?"<>|]/g, '_') + '.wav';
      files[nm] = new Uint8Array(st.wav);
    });
    const zip = zipSync(files, { level: 0 });
    m.close();
    const base = (store.project.name || 'export').replace(/[\\/:*?"<>|]/g, '_');
    await saveFile(base + ' stems.zip', zip.buffer, 'application/zip');
  } catch (e) {
    m.close();
    alertBox(t('Export failed'), String(e.message || e));
  }
}

function projectInfo() {
  const p = store.project;
  const name = h('input', { class: 'input', type: 'text', value: p.name, maxlength: 80 });
  const author = h('input', { class: 'input', type: 'text', value: p.author || '', maxlength: 80, placeholder: t('Optional') });
  const notes = h('textarea', { class: 'input info-notes', maxlength: 2000, rows: 6, placeholder: t('Lyrics, ideas, things to fix...') });
  notes.value = p.notes || '';
  let beats = p.beats || 4;
  const sig = dropdown({ label: t('Time signature'), value: beats, options: TIME_SIGS.map((n) => ({ value: n, label: n + '/4' })), onChange: (v) => { beats = v; } });
  let channelsWithNotes = 0;
  for (const c of p.channels) if (p.patterns.some((pt) => (pt.notes[c.id] || []).length)) channelsWithNotes += 1;
  const noteCount = p.patterns.reduce((a, pt) => a + Object.values(pt.notes).reduce((b, arr) => b + arr.length, 0), 0);
  openModal({
    title: t('Project info'),
    body: h('div', { class: 'form' },
      h('label', { class: 'field' }, h('span', null, t('Name')), name),
      h('label', { class: 'field' }, h('span', null, t('Author')), author),
      h('label', { class: 'field' }, h('span', null, t('Time signature')), sig),
      h('label', { class: 'field' }, h('span', null, t('Notes')), notes),
      h('p', { class: 'set-note' }, [
        p.channels.length + ' ' + t('channels') + ' (' + channelsWithNotes + ' ' + t('with notes') + ')',
        p.patterns.length + ' ' + t('patterns'),
        noteCount + ' ' + t('notes'),
        p.playlist.clips.length + ' ' + t('playlist clips'),
      ].join(', ')),
    ),
    actions: [
      { label: t('Cancel') },
      { label: t('Save'), primary: true, onClick: () => {
        store.change((pp) => {
          pp.name = name.value.trim().slice(0, 80) || pp.name;
          pp.author = author.value.trim().slice(0, 80);
          pp.notes = notes.value.slice(0, 2000);
          pp.beats = beats;
        });
      } },
    ],
  });
}

const SHORTCUTS = [
  ['Space', 'Play / pause'],
  ['L', 'Switch between PAT and SONG'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Y', 'Redo'],
  ['Ctrl+S', 'Save'],
  ['F5', 'Playlist'],
  ['F6', 'Channel rack'],
  ['F7', 'Piano roll'],
  ['F8', 'Browser'],
  ['F9', 'Mixer'],
  ['T', 'Tap tempo'],
  ['M', 'Metronome'],
  ['?', 'Keyboard shortcuts'],
];
const PR_SHORTCUTS = [
  ['P / B / D / E / C', 'Draw, paint, delete, select, slice tools'],
  ['Ctrl+A', 'Select all'],
  ['Ctrl+C / Ctrl+V', 'Copy / paste'],
  ['Ctrl+B', 'Duplicate'],
  ['Ctrl+Q', 'Quantize'],
  ['Up / Down', 'Transpose a semitone (Shift: an octave)'],
  ['Delete', 'Delete the selection'],
];
function shortcutsDialog() {
  const table = (rows) => h('table', { class: 'keys-table' }, rows.map(([k, d]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', null, t(d)))));
  const ext = extHost.shortcuts().map((x) => [x.key.toUpperCase(), x.label]);
  openModal({
    title: t('Keyboard shortcuts'),
    wide: true,
    body: h('div', { class: 'keys' },
      h('h3', null, t('General')), table(SHORTCUTS),
      h('h3', null, 'Piano roll'), table(PR_SHORTCUTS),
      ext.length ? [h('h3', null, t('Extensions')), h('table', { class: 'keys-table' }, ext.map(([k, d]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', null, d))))] : null,
    ),
  });
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
      h('p', null, 'MP3: lamejs (LAME, LGPL 3.0).'),
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
    { label: t('Import MIDI file'), icon: 'FileMusic', onClick: importMidiFile },
    { label: t('Export project file'), icon: 'Share2', onClick: exportProject },
    { label: t('Export project with samples (ZIP)'), icon: 'FileArchive', onClick: exportProjectWithSamples },
    { label: t('Restore a backup'), icon: 'RefreshCw', onClick: restoreBackupDialog },
    { label: ui.songMode ? t('Export song (WAV, MP3)') : t('Export pattern (WAV, MP3)'), icon: 'Download', onClick: exportWav },
    { label: ui.songMode ? t('Export song as MIDI') : t('Export pattern as MIDI'), icon: 'FileMusic', onClick: exportMidi },
    { label: ui.songMode ? t('Export song stems (ZIP)') : t('Export pattern stems (ZIP)'), icon: 'FileArchive', onClick: exportStems },
    { label: t('Project info'), icon: 'NotebookPen', onClick: projectInfo },
    { sep: true },
    { label: t('Settings'), icon: 'Settings', onClick: () => openSettings({ onExtensionsChange: extensionsChanged, engine, extHost }) },
    { label: t('Plugins and themes'), icon: 'Puzzle', onClick: () => openSettings({ section: 'extensions', onExtensionsChange: extensionsChanged, engine, extHost }) },
    ...(updatesSupported() ? [{ label: t('Check for updates'), icon: 'Download', onClick: () => checkForUpdate({ silent: false }) }] : []),
    { sep: true },
    ...(extHost.menuItems().length ? [{ sep: true }, ...extHost.menuItems().map((m) => ({ label: m.label, icon: m.icon || 'Puzzle', onClick: m.onClick }))] : []),
    { sep: true },
    { label: t('Getting started'), icon: 'Lightbulb', onClick: () => openGuide() },
    { label: t('Documentation'), icon: 'BookOpen', onClick: () => openExternal(DOCS_URL) },
    { label: t('Keyboard shortcuts'), icon: 'Keyboard', onClick: shortcutsDialog },
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
  saveTimer = setTimeout(() => {
    saveCurrent(store.project);
    maybeBackup(store.project);
  }, 600);
}
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveCurrent(store.project);
});

let lastTime = '';
let lastState = '';
let lastStateAt = 0;
let lastCpuAt = 0;
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
  if (now - lastCpuAt > 500) {
    lastCpuAt = now;
    cpuVal.textContent = engine.activeVoices() + ' v ' + Math.round(engine.load * 100) + '%';
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
window.addEventListener('pointerdown', () => {
  engine.init();
  if (midiEnabled()) initMidi(engine);
}, { once: true, capture: true });

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
  else if (k === 't' && !mod && ui.panel !== 'piano') tapTempo();
  else if (k === 'm' && !mod && ui.panel !== 'piano') metroBtn.click();
  else if (e.key === '?') shortcutsDialog();
  else if (ui.panel === 'piano' && panels.piano.keydown(e)) return;
  else if (ui.panel === 'playlist' && panels.playlist.keydown(e)) return;
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
if (updatesSupported()) applyOrientation();
if (!guideSeen() && !saved) setTimeout(() => { if (!document.querySelector('.overlay')) openGuide(); }, 900);
