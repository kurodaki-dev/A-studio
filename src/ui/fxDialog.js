import { h, icon, openModal, dropdown, openMenu, promptText, hint, confirmBox } from './dom.js';
import { VOCAL_CHAINS, MASTER_CHAINS, chainSlots, userChains, saveUserChain, deleteUserChain } from '../vocal.js';
import { t } from '../i18n.js';
import { store, FX_SLOTS } from '../store.js';
import { pluginEffects, getPlugin } from '../plugins.js';
import { pluginControls } from './pluginControls.js';

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
          if (!v) m.fx.splice(i, 1);
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
      const source = plugin && plugin.sidechain
        ? h('div', { class: 'pcell' }, h('span', { class: 'pcell-label' }, t('Triggered by')),
            dropdown({
              label: t('Triggered by'),
              value: slot.source || null,
              options: store.project.channels.map((c) => ({ value: c.id, label: c.name })),
              onChange: (v) => {
                slot.source = v;
                emit();
              },
            }))
        : null;
      rows.push(h('div', { class: 'fx-slot' },
        h('div', { class: 'fx-head' }, h('span', { class: 'fx-num' }, String(i + 1)), select, power),
        source,
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
  openModal({ title: t('Effects: ') + m.name, body, wide: true });
}
