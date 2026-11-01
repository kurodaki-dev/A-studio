import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlugin, paramValues, moduleSource } from '../src/plugins.js';
import { validateTheme } from '../src/themes.js';
import { t } from '../src/i18n.js';
import { isInstrumentId } from '../src/audio/catalog.js';
import FR from '../src/locales/fr.js';

import { readFileSync } from 'node:fs';

const supersaw = readFileSync(new URL('../public/doc/examples/supersaw.astudio-plugin.js', import.meta.url), 'utf8');
const snare = readFileSync(new URL('../public/doc/examples/noise-snare.astudio-plugin.js', import.meta.url), 'utf8');

// Run the generated worklet module with a fake AudioWorkletGlobalScope.
function loadProcessor(plugin, options) {
  let Proc = null;
  const scope = { frame: 0 };
  class AudioWorkletProcessor {
    constructor() {
      this.port = { posted: [], postMessage(m) { this.posted.push(m); }, onmessage: null };
    }
  }
  const run = new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'scope', moduleSource(plugin).replace(/currentFrame/g, 'scope.frame'));
  run(AudioWorkletProcessor, (name, P) => { Proc = P; }, 44100, scope);
  const proc = new Proc({ processorOptions: options });
  const render = (blocks) => {
    let peak = 0;
    for (let b = 0; b < blocks; b++) {
      const out = [[new Float32Array(128), new Float32Array(128)]];
      proc.process([], out);
      for (const x of out[0][0]) peak = Math.max(peak, Math.abs(x));
      scope.frame += 128;
    }
    return peak;
  };
  return { proc, render };
}

test('plugin header is parsed without running the code', () => {
  const p = parsePlugin(supersaw);
  assert.equal(p.id, 'supersaw');
  assert.equal(p.name, 'Supersaw');
  assert.equal(p.category, 'synth');
  assert.deepEqual(p.params.map((x) => x.id), ['detune', 'cutoff', 'release']);
  assert.equal(p.params[1].def, 4000);
  assert.equal(parsePlugin(snare).oneShot, true);
});

test('plugin parsing rejects bad files', () => {
  assert.throws(() => parsePlugin(''));
  assert.throws(() => parsePlugin('registerVoice(class {})'));
  assert.throws(() => parsePlugin('/* @astudio-plugin\n@id Bad Id\n@name X */ registerVoice(class {})'));
  assert.throws(() => parsePlugin('/* @astudio-plugin\n@id ok\n */ registerVoice(class {})'));
  assert.throws(() => parsePlugin('/* @astudio-plugin\n@id ok\n@name Ok */ class A {}'));
  assert.throws(() => parsePlugin('/* @astudio-plugin @id ok @name Ok */' + ' '.repeat(300000) + 'registerVoice(A)'));
});

test('a plugin voice produces sound, follows note off and stops', () => {
  const p = parsePlugin(supersaw);
  const params = paramValues(p, {});
  const { proc, render } = loadProcessor(p, { params, events: [{ id: 1, frame: 256, key: 60, freq: 261.63, vel: 1, dur: 0.05 }] });
  assert.equal(render(2), 0, 'silent before the note starts');
  assert.ok(render(20) > 0.01, 'sound after the note starts');
  render(800); // release is 0.4 s
  assert.equal(proc.voices.length, 0, 'voice removed after its release');
});

test('a one shot drum plugin plays and ends by itself', () => {
  const p = parsePlugin(snare);
  const { proc, render } = loadProcessor(p, { params: paramValues(p, {}), events: [{ id: 1, frame: 0, key: 60, freq: 261.63, vel: 1, dur: 0.01 }] });
  assert.ok(render(10) > 0.01);
  render(200);
  assert.equal(proc.voices.length, 0);
});

test('a crashing plugin is isolated and reports the error once', () => {
  const bad = parsePlugin('/* @astudio-plugin\n * @id bad\n * @name Bad\n */ registerVoice(class { process() { throw new Error("boom"); } });');
  const { proc, render } = loadProcessor(bad, { params: {}, events: [{ id: 1, frame: 0, key: 60, freq: 261.63, vel: 1, dur: 1 }, { id: 2, frame: 0, key: 64, freq: 329.6, vel: 1, dur: 1 }] });
  assert.equal(render(4), 0);
  assert.equal(proc.voices.length, 0);
  assert.equal(proc.port.posted.length, 1);
  assert.equal(proc.port.posted[0].type, 'error');
  assert.match(proc.port.posted[0].message, /boom/);
});

test('plugin output is limited and NaN is dropped', () => {
  const loud = parsePlugin('/* @astudio-plugin\n * @id loud\n * @name Loud\n */ registerVoice(class { process(l, r) { l.fill(1000); r.fill(NaN); return true; } });');
  const { render } = loadProcessor(loud, { params: {}, events: [{ id: 1, frame: 0, key: 60, freq: 261.63, vel: 1, dur: Infinity }] });
  assert.equal(render(1), 4);
});

test('voices that never stop are cut 10 seconds after note off', () => {
  const stuck = parsePlugin('/* @astudio-plugin\n * @id stuck\n * @name Stuck\n */ registerVoice(class { process(l) { l.fill(0.1); return true; } });');
  const { proc, render } = loadProcessor(stuck, { params: {}, events: [{ id: 1, frame: 0, key: 60, freq: 261.63, vel: 1, dur: 0.01 }] });
  render(Math.ceil((10.2 * 44100) / 128));
  assert.equal(proc.voices.length, 0);
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

test('the minimal plugin from the documentation works as published', () => {
  const html = readFileSync(new URL('../public/doc/index.html', import.meta.url), 'utf8');
  const block = /<h3>A minimal plugin<\/h3>\s*<pre><code>([\s\S]*?)<\/code><\/pre>/.exec(html)[1];
  const code = block.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const p = parsePlugin(code);
  assert.equal(p.id, 'simple-sine');
  const { proc, render } = loadProcessor(p, { params: paramValues(p, {}), events: [{ id: 1, frame: 0, key: 69, freq: 440, vel: 1, dur: 0.05 }] });
  assert.ok(render(10) > 0.1);
  render(1200); // release time constant 0.3 s: about 2.3 s to fall under the threshold
  assert.equal(proc.voices.length, 0);
});
