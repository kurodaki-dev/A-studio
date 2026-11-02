import { h, btn, icon, hint } from './dom.js';
import { store, getPattern, patternLength, newId } from '../store.js';
import { ui } from '../ui-state.js';
import { BAR, TRACKS, PATTERN_COLORS } from '../constants.js';
import { t } from '../i18n.js';

// Performance mode: one pad per pattern. A pad starts or stops on the next bar.
// With Record on, what you play is written to the playlist as clips.
export function createLive(engine, actions) {
  const grid = h('div', { class: 'live-grid' });
  const recBtn = btn('Circle', t('Record the performance to the playlist'), () => {
    ui.liveRec = !ui.liveRec;
    recBtn.classList.toggle('on', ui.liveRec);
    hint(ui.liveRec ? t('Pads you play will be written to the playlist') : t('Performance recording off'));
  });
  const el = h('div', { class: 'panel live' },
    h('div', { class: 'ptools' },
      h('div', { class: 'grp' }, h('span', { class: 'ptitle' }, t('Live')), h('span', { class: 'rack-info' }, t('Tap a pad: it starts on the next bar. Tap again to stop it.'))),
      h('div', { class: 'grp' }, recBtn, btn('Square', t('Stop every pad'), () => stopAll())),
    ),
    h('div', { class: 'live-scroll' }, grid),
  );
  let pads = [];
  let sig = '';

  // Write the finished part of a pad to the playlist.
  function commitPad(pid, pad) {
    if (!ui.liveRec || !(pad.until > pad.from) || pad.until === Infinity) return;
    const p = store.project;
    const idx = p.patterns.findIndex((x) => x.id === pid);
    store.change((pp) => {
      pp.playlist.clips.push({ id: newId('k'), patternId: pid, track: Math.max(0, idx) % TRACKS, start: pad.from, len: pad.until - pad.from });
    });
  }

  function tap(pid) {
    ui.live = true;
    ui.songMode = false;
    actions.modeChanged();
    if (!engine.playing) {
      for (const [id, pad] of engine.live) commitPad(id, pad);
      engine.live.clear();
      engine.togglePad(pid);
      engine.pos = 0;
      engine.play();
      actions.modeChanged();
    } else {
      const at = engine.togglePad(pid);
      const pad = engine.live.get(pid);
      hint(getPattern(store.project, pid).name + ': ' + (pad.until === Infinity ? t('starts at bar ') : t('stops at bar ')) + (Math.floor(at / BAR) + 1));
      if (pad.until !== Infinity) setTimeout(() => commitPad(pid, pad), 0);
    }
    refresh();
  }

  function stopAll() {
    const pos = engine.playing ? engine.heardPosition() : 0;
    for (const [pid, pad] of engine.live) {
      if (pad.until === Infinity) pad.until = Math.max(pad.from, Math.ceil(pos / BAR) * BAR);
      commitPad(pid, pad);
    }
    engine.live.clear();
    actions.stop();
    refresh();
  }

  function build() {
    const p = store.project;
    pads = p.patterns.map((pat) => {
      const b = h('button', { class: 'live-pad', type: 'button', style: { borderColor: PATTERN_COLORS[pat.color % PATTERN_COLORS.length] }, onClick: () => tap(pat.id) },
        h('i', { class: 'live-led', style: { background: PATTERN_COLORS[pat.color % PATTERN_COLORS.length] } }),
        h('span', null, pat.name),
        h('small', null, patternLength(pat) / BAR + (patternLength(pat) / BAR > 1 ? t(' bars') : t(' bar'))));
      return { id: pat.id, b };
    });
    grid.replaceChildren(...pads.map((x) => x.b), h('p', { class: 'set-note live-note' }, icon('Info', 14), t('Patterns loop from bar 1, so pads of different lengths stay in time. Make more patterns in the channel rack to get more pads.')));
  }

  function refresh() {
    const pos = engine.playing ? engine.heardPosition() : -1;
    for (const x of pads) {
      const pad = engine.live.get(x.id);
      const on = !!pad && engine.playing && pos >= pad.from && pos < pad.until;
      const queued = !!pad && engine.playing && (pos < pad.from || (pad.until !== Infinity && pos < pad.until));
      x.b.classList.toggle('on', on);
      x.b.classList.toggle('queued', queued);
    }
  }

  return {
    el,
    update() {
      const s = store.gen + ':' + store.project.patterns.map((p) => p.id + p.name + p.color + patternLength(p)).join('|');
      if (s !== sig) {
        sig = s;
        build();
      }
      refresh();
    },
    frame() {
      if (engine.playing) refresh();
    },
  };
}
