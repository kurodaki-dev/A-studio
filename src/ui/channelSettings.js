import { h, openModal, dropdown } from './dom.js';
import { pluginInstruments, getPlugin } from '../plugins.js';
import { pluginControls } from './pluginControls.js';
import { knob } from './controls.js';
import { store, getChannel } from '../store.js';
import { CATALOG, CATEGORIES } from '../audio/catalog.js';
import { cutoffHz } from '../audio/engine.js';
import { getSampleMeta } from '../samples.js';
import { t } from '../i18n.js';

export function openChannelSettings(id, engine) {
  const c = getChannel(store.project, id);
  if (!c) return;
  store.commit();
  const set = (fn) => {
    fn();
    store.emit();
  };
  const name = h('input', { class: 'input', type: 'text', value: c.name, maxlength: 80, onInput: (e) => set(() => { c.name = e.target.value || t('Channel'); }) });
  const inst = dropdown({
    label: t('Instrument'),
    value: c.instrument,
    options: [
      ...(c.sample ? [{ value: 'sampler', label: t('Sampler: ') + ((getSampleMeta(c.sample) || {}).name || t('Missing sample')), group: 'Sample' }] : []),
      ...pluginInstruments().map((p) => ({ value: 'plugin:' + p.id, label: p.name, group: t('Plugins') })),
      ...CATEGORIES.flatMap((cat) => CATALOG.filter((x) => x.cat === cat.id).map((x) => ({ value: x.id, label: x.name, group: cat.name }))),
    ],
    onChange: (v) => {
      set(() => { c.instrument = v; });
      engine.preview(c, 60);
      // Rebuild the window so the knobs of the new instrument show.
      modal.close();
      openChannelSettings(id, engine);
    },
  });
  const insert = dropdown({
    label: t('Mixer insert'),
    value: c.insert,
    options: store.project.mixer.map((m, i) => ({ value: i, label: i === 0 ? 'Master' : i + '  ' + m.name })),
    onChange: (v) => set(() => { c.insert = v; }),
  });
  const pitchOut = h('output', null);
  const pitch = h('input', { type: 'range', class: 'range', min: -24, max: 24, step: 1, value: c.params.pitch, onInput: (e) => set(() => { c.params.pitch = Number(e.target.value); showPitch(); }) });
  const showPitch = () => { pitchOut.textContent = (c.params.pitch > 0 ? '+' : '') + c.params.pitch + t(' semitones'); };
  showPitch();
  // Controls declared by a code plugin in its header.
  function pluginKnobs() {
    const plugin = c.instrument.startsWith('plugin:') ? getPlugin(c.instrument.slice(7)) : null;
    if (!plugin || !plugin.params.length) return null;
    return h('div', null,
      h('div', { class: 'field' }, h('span', null, plugin.name)),
      pluginControls(plugin, c.pluginParams, {
        onChange: (values) => set(() => { c.pluginParams = values; }),
        onButton: (bid) => engine.channelButton(c.id, bid),
      }),
    );
  }
  const sec = (v) => (v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s');
  const k = (label, key, max, def, fmt) =>
    h('label', { class: 'kl big' },
      knob({ value: c.params[key], min: 0, max, def, size: 36, label, format: fmt, onInput: (v) => set(() => { c.params[key] = v; }) }),
      h('span', null, label),
    );
  const body = h('div', { class: 'form' },
    h('label', { class: 'field' }, h('span', null, t('Name')), name),
    h('label', { class: 'field' }, h('span', null, 'Instrument'), inst),
    h('label', { class: 'field' }, h('span', null, t('Mixer insert')), insert),
    h('label', { class: 'field' }, h('span', null, 'Transposition'), h('div', { class: 'rangebox' }, pitch, pitchOut)),
    c.instrument === 'sampler'
      ? h('div', { class: 'field' }, h('span', null, t('Sample')),
          h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!c.params.reverse, onChange: (e) => set(() => { c.params.reverse = e.target.checked; engine.preview(c, 60, 0.8, 0.6); }) }), h('span', null, t('Play reversed'))))
      : null,
    h('div', { class: 'knobs' },
      k(t('Attack'), 'attack', 2, 0, sec),
      k(t('Release'), 'release', 3, 0, sec),
      k(t('Filter'), 'cutoff', 1, 1, (v) => Math.round(cutoffHz(v)) + ' Hz'),
      k(t('Resonance'), 'reso', 1, 0, (v) => Math.round(v * 100) + '%'),
    ),
    pluginKnobs(),
    h('button', { class: 'b tb', type: 'button', onClick: () => engine.preview(c, 60, 0.8, 0.6) }, t('Preview')),
  );
  const modal = openModal({ title: t('Channel settings'), body, wide: true });
}
