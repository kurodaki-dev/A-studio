import { h, icon, openModal, dropdown } from './dom.js';
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
        options: [{ value: '', label: t('Empty') }, ...effects.map((p) => ({ value: p.id, label: p.name })), ...(slot && !plugin ? [{ value: slot.plugin, label: slot.plugin + ' (' + t('missing') + ')' }] : [])],
        onChange: (v) => {
          if (!v) m.fx.splice(i, 1);
          else if (slot) m.fx[i] = { plugin: v, on: true, params: {} };
          else m.fx.push({ plugin: v, on: true, params: {} });
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
      rows.push(h('div', { class: 'fx-slot' },
        h('div', { class: 'fx-head' }, h('span', { class: 'fx-num' }, String(i + 1)), select, power),
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
      effects.length ? null : h('p', { class: 'empty' }, t('No effect plugin installed. Install one in Plugins and themes, or write one with the plugin editor.')),
      ...rows,
      h('div', { class: 'set-actions' }, h('button', { class: 'b tb', type: 'button', onClick: () => onShowPlugins && onShowPlugins() }, icon('Puzzle', 16), t('Plugins and themes'))),
    ];
    body.replaceChildren(...parts.filter(Boolean));
  }
  render();
  openModal({ title: t('Effects: ') + m.name, body, wide: true });
}
