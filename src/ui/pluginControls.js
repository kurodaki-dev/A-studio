import { h, dropdown, hint } from './dom.js';
import { knob } from './controls.js';
import { paramValues } from '../plugins.js';

// Builds the controls a plugin declares in its header: knobs, switches,
// choice lists and push buttons. onChange(values) receives all values.
export function pluginControls(plugin, stored, { onChange, onButton }) {
  if (!plugin.params.length) return null;
  const values = paramValues(plugin, stored);
  const fmt = (v) => (Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(2));
  const set = (id, v) => {
    values[id] = v;
    onChange({ ...values });
  };
  return h('div', { class: 'pctl' },
    plugin.params.map((p) => {
      if (p.kind === 'knob') {
        return h('label', { class: 'kl big' },
          knob({ value: values[p.id], min: p.min, max: p.max, def: p.def, size: 36, label: p.name, format: fmt, onInput: (v) => set(p.id, v) }),
          h('span', null, p.name));
      }
      if (p.kind === 'toggle') {
        const b = h('button', { class: 'b tb ptoggle' + (values[p.id] ? ' on' : ''), type: 'button', 'aria-pressed': String(!!values[p.id]), onClick: () => {
          const v = values[p.id] ? 0 : 1;
          b.classList.toggle('on', !!v);
          b.setAttribute('aria-pressed', String(!!v));
          set(p.id, v);
        } }, h('i', { class: 'ptoggle-led' }), p.name);
        return h('div', { class: 'pcell' }, b);
      }
      if (p.kind === 'choice') {
        return h('div', { class: 'pcell' },
          h('span', { class: 'pcell-label' }, p.name),
          dropdown({ label: p.name, value: values[p.id], options: p.options.map((o, i) => ({ value: i, label: o })), onChange: (v) => set(p.id, v) }));
      }
      return h('div', { class: 'pcell' }, h('button', { class: 'b tb', type: 'button', onClick: () => {
        onButton(p.id);
        hint(plugin.name + ' : ' + p.name);
      } }, p.name));
    }),
  );
}
