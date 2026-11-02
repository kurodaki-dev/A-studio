import { h, icon, openModal, dropdown, openMenu, promptText, hint, confirmBox } from './dom.js';
import { VOCAL_CHAINS, MASTER_CHAINS, chainSlots, userChains, saveUserChain, deleteUserChain } from '../vocal.js';
import { t } from '../i18n.js';
import { store, FX_SLOTS } from '../store.js';
import { pluginEffects, getPlugin } from '../plugins.js';
import { pluginControls } from './pluginControls.js';
import { currentTheme } from '../themes.js';
import { noteName } from '../constants.js';

// Effect slots of a mixer insert.
export function openFxDialog(index, engine, onShowPlugins) {
  const m = store.project.mixer[index];
  if (!m) return;
  store.commit();
  if (!Array.isArray(m.fx)) m.fx = [];
  const body = h('div', { class: 'fx' });
  const emit = () => store.emit();

  function render() {
    const effects = pluginEffects();
    const rows = [];
    for (let i = 0; i < FX_SLOTS; i++) {
      const slot = m.fx[i] || null;
      const plugin = slot ? getPlugin(slot.plugin) : null;
      const select = dropdown({
        label: t('Effect slot ') + (i + 1),
        value: slot ? slot.plugin : '',
        options: [{ value: '', label: t('Empty') }, ...effects.map((p) => ({ value: p.id, label: p.builtin ? t(p.name) : p.name, group: p.builtin ? (p.vocal ? t('Voice') : t('Mix')) : t('Plugins') })), ...(slot && !plugin ? [{ value: slot.plugin, label: slot.plugin + ' (' + t('missing') + ')' }] : [])],
        onChange: (v) => {
          const fresh = { plugin: v, on: true, params: {} };
          if (getPlugin(v) && getPlugin(v).sidechain) {
            const kick = store.project.channels.find((c) => c.instrument === 'kick') || store.project.channels[0];
            if (kick) fresh.source = kick.id;
          }
          if (!v) {
            m.fx.splice(i, 1);
            // Automation of the removed slot goes, later slots move down one place.
            store.project.playlist.clips = store.project.playlist.clips.filter((c) => c.type !== 'auto' || c.target.split(':').slice(0, 3).join(':') !== 'fx:' + index + ':' + i);
            for (const c of store.project.playlist.clips) {
              const mt = c.type === 'auto' && /^fx:(\d+):(\d):(.+)$/.exec(c.target);
              if (mt && Number(mt[1]) === index && Number(mt[2]) > i) c.target = 'fx:' + index + ':' + (Number(mt[2]) - 1) + ':' + mt[3];
            }
          }
          else if (slot) m.fx[i] = fresh;
          else m.fx.push(fresh);
          emit();
          render();
        },
      });
      const power = slot
        ? h('button', { class: 'b tb ptoggle' + (slot.on !== false ? ' on' : ''), type: 'button', title: t('Effect on or off'), onClick: () => {
            slot.on = slot.on === false;
            emit();
            render();
          } }, h('i', { class: 'ptoggle-led' }), slot.on !== false ? t('On') : t('Off'))
        : null;
      const srcLabel = plugin && plugin.sidechain ? t('Triggered by') : plugin && plugin.followsChannel ? t('Melody from (MIDI target)') : null;
      const source = srcLabel
        ? h('div', { class: 'pcell' }, h('span', { class: 'pcell-label' }, srcLabel),
            dropdown({
              label: srcLabel,
              value: slot.source || '',
              options: [...(plugin.followsChannel ? [{ value: '', label: t('None') }] : []), ...store.project.channels.map((c) => ({ value: c.id, label: c.name }))],
              onChange: (v) => {
                if (v) slot.source = v;
                else delete slot.source;
                emit();
              },
            }))
        : null;
      const graph = plugin && plugin.followsChannel && slot.on !== false ? pitchGraph(slot) : null;
      rows.push(h('div', { class: 'fx-slot' },
        h('div', { class: 'fx-head' }, h('span', { class: 'fx-num' }, String(i + 1)), select, power),
        source,
        graph,
        plugin && slot.on !== false
          ? pluginControls(plugin, slot.params, {
              onChange: (values) => {
                slot.params = values;
                emit();
              },
              onButton: (bid) => engine.effectButton(index, slot, bid),
            })
          : null,
      ));
      if (!slot) break; // one empty slot at a time
    }
    const parts = [
      h('p', { class: 'set-note' }, t('Built in effects: compressor, limiter, filter, distortion, sidechain, and for voices auto tune, voice changer, harmonizer, noise gate, de-esser, doubler, reverb, echo and robot. Add more with effect plugins.')),
      h('div', { class: 'set-actions' },
        h('button', { class: 'b tb primary', type: 'button', onClick: (e) => chainMenu(e.currentTarget) }, icon(index === 0 ? 'SlidersVertical' : 'Mic', 16), index === 0 ? t('Mastering chains') : t('Vocal chains')),
        h('button', { class: 'b tb', type: 'button', onClick: () => saveChain() }, icon('Save', 16), t('Save this chain')),
      ),
      ...rows,
      h('div', { class: 'set-actions' }, h('button', { class: 'b tb', type: 'button', onClick: () => onShowPlugins && onShowPlugins() }, icon('Puzzle', 16), t('Plugins and themes'))),
    ];
    body.replaceChildren(...parts.filter(Boolean));
  }
  // Live pitch graph of an auto tune slot: sung pitch (grey) and corrected pitch.
  const graphs = new Map();
  function pitchGraph(slot) {
    let gph = graphs.get(slot);
    if (!gph) {
      const cv = h('canvas', { class: 'pitch-graph', width: 640, height: 130, 'aria-label': t('Pitch graph') });
      gph = { cv, hist: [], fx: null };
      graphs.set(slot, gph);
    }
    return h('div', { class: 'pitch-wrap' }, gph.cv, h('p', { class: 'set-note' }, t('Grey: the note you sing. Colour: the corrected note. Play the song or turn on the microphone with effects to see it.')));
  }
  let alive = true;
  function drawGraphs() {
    if (!alive) return;
    for (const [slot, gph] of graphs) {
      if (!gph.cv.isConnected) continue;
      const fx = engine.effectInstance(index, slot);
      if (fx && fx !== gph.fx) {
        gph.fx = fx;
        fx.onPitch = (d) => {
          gph.hist.push(d);
          if (gph.hist.length > 150) gph.hist.shift();
        };
      }
      const g = gph.cv.getContext('2d');
      const W = gph.cv.width;
      const H = gph.cv.height;
      const th = currentTheme();
      g.fillStyle = th.colors.input;
      g.fillRect(0, 0, W, H);
      const voiced = gph.hist.filter((d) => d.input != null);
      const centre = voiced.length ? Math.round(voiced[voiced.length - 1].output) : 69;
      const span = 14;
      const yOf = (m) => H / 2 - ((m - centre) / span) * H;
      g.font = '10px system-ui, sans-serif';
      for (let k = centre - 7; k <= centre + 7; k++) {
        const y = Math.round(yOf(k));
        g.fillStyle = [1, 3, 6, 8, 10].includes(((k % 12) + 12) % 12) ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.06)';
        g.fillRect(0, y - H / span / 2, W, H / span);
        g.fillStyle = th.colors.dim;
        if (k % 12 === 0 || k === centre) g.fillText(noteName(k), 2, y + 3);
      }
      const step = W / 150;
      const line = (key, color) => {
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.beginPath();
        let pen = false;
        gph.hist.forEach((d, i) => {
          const v = d[key];
          if (v == null) { pen = false; return; }
          const x = W - (gph.hist.length - i) * step;
          if (!pen) g.moveTo(x, yOf(v));
          else g.lineTo(x, yOf(v));
          pen = true;
        });
        g.stroke();
        // Dots too, so short notes show even without a line.
        g.fillStyle = color;
        gph.hist.forEach((d, i) => {
          if (d[key] == null) return;
          g.fillRect(W - (gph.hist.length - i) * step - 1.5, yOf(d[key]) - 1.5, 3, 3);
        });
      };
      line('input', 'rgba(200,210,215,0.6)');
      line('output', th.colors.accent);
    }
    requestAnimationFrame(drawGraphs);
  }
  requestAnimationFrame(drawGraphs);

  function applyChain(slots, name) {
    m.fx = slots;
    emit();
    render();
    hint(t('Chain loaded: ') + name);
  }

  function chainMenu(anchor) {
    const mine = userChains();
    openMenu(anchor, [
      { header: t('Replaces the effects of this insert') },
      ...(index === 0 ? MASTER_CHAINS : VOCAL_CHAINS).map((c) => ({ label: t(c.name), icon: index === 0 ? 'SlidersVertical' : 'Mic', onClick: () => applyChain(chainSlots(c), t(c.name)) })),
      ...(index === 0 ? [{ sep: true }, ...VOCAL_CHAINS.map((c) => ({ label: t(c.name), icon: 'Mic', onClick: () => applyChain(chainSlots(c), t(c.name)) }))] : []),
      ...(mine.length ? [{ sep: true }, { header: t('My chains') }, ...mine.map((c) => ({ label: c.name, icon: 'Save', onClick: () => applyChain(chainSlots(c), c.name) }))] : []),
      ...(mine.length ? [{ sep: true }, { label: t('Delete one of my chains') + '...', icon: 'Trash', onClick: () => openMenu(anchor, mine.map((c) => ({ label: c.name, icon: 'Trash', onClick: async () => {
        if (await confirmBox(t('Delete chain'), c.name, t('Delete'))) deleteUserChain(c.name);
      } }))) }] : []),
    ]);
  }

  async function saveChain() {
    if (!m.fx.length) return hint(t('Add effects first'));
    const name = await promptText(t('Chain name'), m.name);
    if (!name) return;
    try {
      saveUserChain(name, m.fx);
      hint(t('Chain saved: ') + name);
    } catch {
      hint(t('Could not save'));
    }
  }

  render();
  openModal({ title: t('Effects: ') + m.name, body, wide: true, onClose: () => { alive = false; } });
}
