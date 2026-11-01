import { h, openModal } from './dom.js';
import { knob } from './controls.js';
import { store, getChannel } from '../store.js';
import { CATALOG, CATEGORIES } from '../audio/catalog.js';
import { cutoffHz } from '../audio/engine.js';

export function openChannelSettings(id, engine) {
  const c = getChannel(store.project, id);
  if (!c) return;
  store.commit();
  const set = (fn) => {
    fn();
    store.emit();
  };
  const name = h('input', { class: 'input', type: 'text', value: c.name, maxlength: 80, onInput: (e) => set(() => { c.name = e.target.value || 'Canal'; }) });
  const inst = h('select', { class: 'sel', onChange: (e) => set(() => { c.instrument = e.target.value; engine.preview(c, 60); }) },
    CATEGORIES.map((cat) => h('optgroup', { label: cat.name }, CATALOG.filter((x) => x.cat === cat.id).map((x) => h('option', { value: x.id, selected: x.id === c.instrument }, x.name)))),
  );
  const insert = h('select', { class: 'sel', onChange: (e) => set(() => { c.insert = Number(e.target.value); }) },
    store.project.mixer.map((m, i) => h('option', { value: i, selected: c.insert === i }, i === 0 ? 'Master' : i + '  ' + m.name)),
  );
  const pitchOut = h('output', null);
  const pitch = h('input', { type: 'range', class: 'range', min: -24, max: 24, step: 1, value: c.params.pitch, onInput: (e) => set(() => { c.params.pitch = Number(e.target.value); showPitch(); }) });
  const showPitch = () => { pitchOut.textContent = (c.params.pitch > 0 ? '+' : '') + c.params.pitch + ' demi tons'; };
  showPitch();
  const sec = (v) => (v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s');
  const k = (label, key, max, def, fmt) =>
    h('label', { class: 'kl big' },
      knob({ value: c.params[key], min: 0, max, def, size: 36, label, format: fmt, onInput: (v) => set(() => { c.params[key] = v; }) }),
      h('span', null, label),
    );
  const body = h('div', { class: 'form' },
    h('label', { class: 'field' }, h('span', null, 'Nom'), name),
    h('label', { class: 'field' }, h('span', null, 'Instrument'), inst),
    h('label', { class: 'field' }, h('span', null, 'Insert du mixer'), insert),
    h('label', { class: 'field' }, h('span', null, 'Transposition'), h('div', { class: 'rangebox' }, pitch, pitchOut)),
    h('div', { class: 'knobs' },
      k('Attaque', 'attack', 2, 0, sec),
      k('Relâchement', 'release', 3, 0, sec),
      k('Filtre', 'cutoff', 1, 1, (v) => Math.round(cutoffHz(v)) + ' Hz'),
      k('Résonance', 'reso', 1, 0, (v) => Math.round(v * 100) + '%'),
    ),
    h('button', { class: 'b tb', type: 'button', onClick: () => engine.preview(c, 60, 0.8, 0.6) }, 'Écouter'),
  );
  openModal({ title: 'Paramètres du canal', body, wide: true });
}
