import { h, btn, dropdown, hint, promptText, confirmBox } from './dom.js';
import { knob } from './controls.js';
import { paramValues, userPresets, saveUserPreset, deleteUserPreset } from '../plugins.js';
import { t } from '../i18n.js';

// Builds the controls a plugin declares in its header (knobs, switches,
// choice lists, push buttons) and its presets. onChange(values) receives
// all values after every change.
export function pluginControls(plugin, stored, { onChange, onButton }) {
  if (!plugin.params.length) return null;
  // Built in effects are translated; plugins show their own names.
  const tr = (x) => (plugin.builtin ? t(x) : x);
  let values = paramValues(plugin, stored);
  const root = h('div', { class: 'pctl-wrap' });
  const fmt = (v) => (Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(2));
  const set = (id, v) => {
    values[id] = v;
    onChange({ ...values });
  };

  function applyPreset(p) {
    values = paramValues(plugin, { ...values, ...p.values });
    onChange({ ...values });
    hint(plugin.name + ' : ' + p.name);
    render(p.name);
  }

  function presetBar(current) {
    const factory = plugin.presets.map((p) => ({ value: 'f:' + p.name, label: tr(p.name), group: t('Factory presets'), p }));
    const mine = userPresets(plugin.id).map((p) => ({ value: 'u:' + p.name, label: p.name, group: t('My presets'), p }));
    const options = [...factory, ...mine];
    const cur = options.find((o) => o.label === current);
    const dd = options.length
      ? dropdown({ label: t('Presets'), value: cur ? cur.value : null, options: options.map(({ value, label, group }) => ({ value, label, group })), onChange: (v) => applyPreset(options.find((o) => o.value === v).p) })
      : null;
    const save = btn('Save', t('Save as preset'), async () => {
      const name = await promptText(t('Preset name'), cur ? cur.label : '');
      if (!name) return;
      try {
        saveUserPreset(plugin.id, name, { ...values });
        hint(t('Preset saved: ') + name);
        render(name);
      } catch {
        hint(t('Could not save'));
      }
    });
    const del = cur && cur.value.startsWith('u:')
      ? btn('Trash', t('Delete preset'), async () => {
          if (await confirmBox(t('Delete preset'), cur.label, t('Delete'))) {
            deleteUserPreset(plugin.id, cur.label);
            render(null);
          }
        })
      : null;
    return h('div', { class: 'preset-bar' }, h('span', { class: 'pcell-label' }, t('Presets')), dd || h('span', { class: 'pcell-label' }, t('none')), save, del);
  }

  function controls() {
    return h('div', { class: 'pctl' },
      plugin.params.map((p) => {
        if (p.kind === 'knob') {
          return h('label', { class: 'kl big' },
            knob({ value: values[p.id], min: p.min, max: p.max, def: p.def, size: 36, label: tr(p.name), format: fmt, onInput: (v) => set(p.id, v) }),
            h('span', null, tr(p.name)));
        }
        if (p.kind === 'toggle') {
          const b = h('button', { class: 'b tb ptoggle' + (values[p.id] ? ' on' : ''), type: 'button', 'aria-pressed': String(!!values[p.id]), onClick: () => {
            const v = values[p.id] ? 0 : 1;
            b.classList.toggle('on', !!v);
            b.setAttribute('aria-pressed', String(!!v));
            set(p.id, v);
          } }, h('i', { class: 'ptoggle-led' }), tr(p.name));
          return h('div', { class: 'pcell' }, b);
        }
        if (p.kind === 'choice') {
          return h('div', { class: 'pcell' },
            h('span', { class: 'pcell-label' }, tr(p.name)),
            dropdown({ label: tr(p.name), value: values[p.id], options: p.options.map((o, i) => ({ value: i, label: tr(o) })), onChange: (v) => set(p.id, v) }));
        }
        return h('div', { class: 'pcell' }, h('button', { class: 'b tb', type: 'button', onClick: () => {
          onButton(p.id);
          hint(plugin.name + ' : ' + p.name);
        } }, p.name));
      }),
    );
  }

  function render(current) {
    root.replaceChildren(presetBar(current), controls());
  }
  render(null);
  return root;
}
