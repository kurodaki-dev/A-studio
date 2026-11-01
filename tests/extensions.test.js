import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlugin } from '../src/plugins.js';
import { validateTheme } from '../src/themes.js';
import { t } from '../src/i18n.js';
import { isInstrumentId } from '../src/audio/catalog.js';
import FR from '../src/locales/fr.js';

const plugin = {
  type: 'astudio-plugin',
  kind: 'instrument',
  id: 'warm-pad',
  name: 'Warm Pad',
  oscillators: [{ wave: 'sawtooth', detune: -7, gain: 0.5 }, { wave: 'evil', gain: 9, octave: 12 }],
  envelope: { attack: 0.4, release: 99 },
  filter: { type: 'lowpass', cutoff: 1e9 },
  lfo: { target: 'pitch', rate: 5, depth: 6 },
};

test('plugin validation cleans and clamps values', () => {
  const p = validatePlugin(plugin);
  assert.equal(p.id, 'warm-pad');
  assert.equal(p.oscillators[1].wave, 'sine');
  assert.equal(p.oscillators[1].gain, 1);
  assert.equal(p.oscillators[1].octave, 3);
  assert.equal(p.envelope.release, 10);
  assert.equal(p.filter.cutoff, 20000);
  assert.equal(p.category, 'synth');
});

test('plugin validation rejects bad files', () => {
  assert.throws(() => validatePlugin(null));
  assert.throws(() => validatePlugin({ ...plugin, type: 'x' }));
  assert.throws(() => validatePlugin({ ...plugin, id: 'Bad Id!' }));
  assert.throws(() => validatePlugin({ ...plugin, oscillators: [] }));
  assert.throws(() => validatePlugin({ ...plugin, name: '' }));
});

test('theme validation keeps only hex colors', () => {
  const th = validateTheme({ type: 'astudio-theme', id: 'ocean', name: 'Ocean', colors: { accent: '#00aaff', bg: 'red; background:url(x)' }, editor: { note: '#0af' } });
  assert.equal(th.colors.accent, '#00aaff');
  assert.equal(th.colors.bg, '#1e2427');
  assert.equal(th.editor.note, '#0af');
  assert.throws(() => validateTheme({ type: 'astudio-theme', id: 'default', name: 'X' }));
  assert.throws(() => validateTheme({ type: 'astudio-theme', id: 'ok', name: '' }));
});

test('plugin instrument ids are accepted in projects', () => {
  assert.equal(isInstrumentId('plugin:warm-pad'), true);
  assert.equal(isInstrumentId('plugin:../x'), false);
  assert.equal(isInstrumentId('piano'), true);
  assert.equal(isInstrumentId('nope'), false);
});

test('English is the default language and French has no empty entries', () => {
  assert.equal(t('Save'), 'Save');
  assert.equal(FR.Save, 'Enregistrer');
  for (const [k, v] of Object.entries(FR)) assert.ok(typeof v === 'string' && v.length > 0, k);
});
