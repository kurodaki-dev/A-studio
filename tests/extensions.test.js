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
  const src = moduleSource(plugin).replace(/currentFrame/g, 'scope.frame').replace(/currentTime/g, '(scope.frame / 44100)');
  const run = new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'scope', src);
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

const ex = (f) => readFileSync(new URL('../public/doc/examples/' + f, import.meta.url), 'utf8');

function runEffect(plugin, params, input) {
  const { proc } = loadProcessor(plugin, { params });
  const blocks = [];
  for (let b = 0; b < input.length; b++) {
    const out = [[new Float32Array(128), new Float32Array(128)]];
    proc.process([[input[b], input[b]]], out);
    blocks.push(out[0]);
  }
  return { proc, blocks };
}

test('all control types are parsed in order', () => {
  const p = parsePlugin(ex('poly-synth.astudio-plugin.js'));
  assert.deepEqual(p.params.map((c) => c.kind + ':' + c.id), ['choice:wave', 'knob:cutoff', 'knob:reso', 'knob:attack', 'knob:release', 'toggle:sub', 'button:drift']);
  assert.deepEqual(p.params[0].options, ['saw', 'square', 'triangle', 'sine']);
  const v = paramValues(p, { wave: 2.7, sub: 0.4, drift: 5 });
  assert.equal(v.wave, 3);
  assert.equal(v.sub, 0);
  assert.equal('drift' in v, false, 'buttons hold no stored value');
});

test('effect plugins need registerEffect and are typed', () => {
  const p = parsePlugin(ex('bitcrusher.astudio-plugin.js'));
  assert.equal(p.type, 'effect');
  assert.throws(() => parsePlugin('/* @astudio-plugin\n * @id e\n * @name E\n * @type effect\n */ registerVoice(class {})'), /registerEffect/);
});

test('the bitcrusher effect changes the sound', () => {
  const p = parsePlugin(ex('bitcrusher.astudio-plugin.js'));
  const input = Array.from({ length: 4 }, (_, b) => Float32Array.from({ length: 128 }, (_, i) => Math.sin((b * 128 + i) / 9) * 0.5));
  const { blocks } = runEffect(p, paramValues(p, { bits: 2, rate: 8, mix: 1 }), input);
  const distinct = new Set(blocks.flatMap((o) => [...o[0]].map((x) => x.toFixed(4))));
  assert.ok(distinct.size <= 5, 'quantized to a few levels');
});

test('the stereo delay echoes and its Clear button empties the buffer', () => {
  const p = parsePlugin(ex('stereo-delay.astudio-plugin.js'));
  const params = paramValues(p, { sync: 0, time: 20, mix: 1, feedback: 0.5, pingpong: 0 });
  const impulse = new Float32Array(128);
  impulse[0] = 1;
  const silent = () => new Float32Array(128);
  const { proc, blocks } = runEffect(p, params, [impulse, ...Array.from({ length: 12 }, silent)]);
  const peakAfter = Math.max(...blocks.slice(5).flatMap((o) => [...o[0]].map(Math.abs)));
  assert.ok(peakAfter > 0.05, 'echo heard after the dry sound');
  proc.port.onmessage({ data: { type: 'button', id: 'clear' } });
  const out = [[new Float32Array(128), new Float32Array(128)]];
  proc.process([[silent(), silent()]], out);
  assert.equal(Math.max(...out[0][0].map(Math.abs)), 0);
});

test('a broken effect lets the sound through and reports once', () => {
  const p = parsePlugin('/* @astudio-plugin\n * @id bad-fx\n * @name Bad FX\n * @type effect\n */ registerEffect(class { process() { throw new Error("fx boom"); } });');
  const input = [Float32Array.from({ length: 128 }, () => 0.25), Float32Array.from({ length: 128 }, () => 0.25)];
  const { proc, blocks } = runEffect(p, {}, input);
  assert.equal(blocks[1][0][10], 0.25);
  assert.equal(proc.port.posted.length, 1);
  assert.match(proc.port.posted[0].message, /fx boom/);
});

test('the poly synth example plays, reacts to its button and stops', () => {
  const p = parsePlugin(ex('poly-synth.astudio-plugin.js'));
  const { proc, render } = loadProcessor(p, { params: paramValues(p, {}), events: [{ id: 1, frame: 0, key: 57, freq: 220, vel: 1, dur: 0.2 }] });
  assert.ok(render(20) > 0.01);
  const before = proc.voices[0].inst.drift;
  proc.port.onmessage({ data: { type: 'button', id: 'drift' } });
  assert.notEqual(proc.voices[0].inst.drift, before);
  render(2000);
  assert.equal(proc.voices.length, 0);
});

test('every example plugin parses', () => {
  for (const f of ['supersaw', 'fm-bell', 'noise-snare', 'poly-synth', 'bitcrusher', 'stereo-delay']) parsePlugin(ex(f + '.astudio-plugin.js'));
});

test('the plugin editor templates are valid and make sound', async () => {
  const { INSTRUMENT_TEMPLATE, EFFECT_TEMPLATE } = await import('../src/ui/pluginEditor.js');
  const inst = parsePlugin(INSTRUMENT_TEMPLATE);
  assert.deepEqual(inst.params.map((c) => c.kind), ['choice', 'knob', 'knob', 'toggle']);
  const { render } = loadProcessor(inst, { params: paramValues(inst, {}), events: [{ id: 1, frame: 0, key: 60, freq: 261.63, vel: 1, dur: 0.1 }] });
  assert.ok(render(20) > 0.01);
  const fx = parsePlugin(EFFECT_TEMPLATE);
  assert.equal(fx.type, 'effect');
  const input = [Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 5) * 0.5)];
  const { blocks } = runEffect(fx, paramValues(fx, {}), input);
  assert.ok(Math.max(...blocks[0][0].map(Math.abs)) > 0.1);
});

test('the effect example from the documentation works as published', () => {
  const html = readFileSync(new URL('../public/doc/index.html', import.meta.url), 'utf8');
  const block = /<h3>Effects<\/h3>\s*<pre><code>([\s\S]*?)<\/code><\/pre>/.exec(html)[1];
  const p = parsePlugin(block.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  assert.equal(p.type, 'effect');
  const input = [Float32Array.from({ length: 128 }, () => 0.9)];
  const { blocks } = runEffect(p, paramValues(p, {}), input);
  assert.ok(Math.abs(blocks[0][0][0] - Math.tanh(3.6)) < 1e-6);
});

test('extension header: type, permissions, no audio requirement', async () => {
  const { EXTENSION_TEMPLATE } = await import('../src/ui/pluginEditor.js');
  const p = parsePlugin(EXTENSION_TEMPLATE);
  assert.equal(p.type, 'extension');
  assert.deepEqual(p.permissions, ['ui', 'transport']);
  const tools = parsePlugin(ex('beat-tools.astudio-plugin.js'));
  assert.deepEqual(tools.permissions, ['ui', 'transport', 'project-read', 'project-write']);
  const odd = parsePlugin('/* @astudio-plugin\n * @id odd\n * @name Odd\n * @type extension\n * @permissions ui, root, project-write\n */ astudio.ui.hint("x")');
  assert.deepEqual(odd.permissions, ['ui', 'project-write']);
});

test('every API method of the extension bootstrap has a permission', async () => {
  const { BOOTSTRAP, METHOD_PERMISSION } = await import('../src/extensions.js');
  const used = [...BOOTSTRAP.matchAll(/call\('([a-zA-Z.]+)'/g)].map((m) => m[1]);
  const viaClick = [...BOOTSTRAP.matchAll(/withClick\('([a-zA-Z.]+)'\)/g)].map((m) => m[1]);
  const all = new Set([...used, ...viaClick]);
  assert.ok(all.size >= 14);
  for (const m of all) assert.ok(METHOD_PERMISSION[m], m);
});

test('extension frame documents cannot be closed early by the plugin code', async () => {
  const { frameDoc } = await import('../src/extensions.js');
  const doc = frameDoc('const s = "</script><script>alert(1)</script>";', '<p>hi</p>');
  assert.equal((doc.match(/<\/script>/g) || []).length, 2, 'only the bootstrap and plugin scripts close');
  assert.ok(doc.includes('<\\/script><script>alert(1)<\\/script>'));
});

test('the extension example from the documentation parses as published', () => {
  const html = readFileSync(new URL('../public/doc/index.html', import.meta.url), 'utf8');
  const block = /<h3 id="extensions">Extensions<\/h3>[\s\S]*?<pre><code>([\s\S]*?)<\/code><\/pre>/.exec(html)[1];
  const code = block.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const p = parsePlugin(code);
  assert.equal(p.type, 'extension');
  assert.deepEqual(p.permissions, ['ui', 'transport']);
  new Function('astudio', code); // valid JavaScript
});


test('factory presets are parsed and only keep known controls', () => {
  const p = parsePlugin(ex('poly-synth.astudio-plugin.js'));
  assert.deepEqual(p.presets.map((x) => x.name), ['Warm pad', 'Square lead', 'Acid', 'Soft keys']);
  assert.deepEqual(p.presets[2].values, { wave: 0, cutoff: 700, reso: 0.9, attack: 0.002, release: 0.12, sub: 0 });
  const q = parsePlugin('/* @astudio-plugin\n * @id q\n * @name Q\n * @param a "A" 0 1 0.5\n * @button b "B"\n * @preset "X" a=0.9 b=3 zz=1\n */ registerVoice(class {})');
  assert.deepEqual(q.presets[0].values, { a: 0.9 });
});

test('effects receive the tempo: a synced delay follows transport.bpm', () => {
  const p = parsePlugin(ex('stereo-delay.astudio-plugin.js'));
  const echoAt = (bpm) => {
    const { proc } = loadProcessor(p, { params: paramValues(p, { sync: 1, division: 1, mix: 1, feedback: 0, pingpong: 0 }), transport: { bpm, playing: false } });
    const impulse = new Float32Array(128);
    impulse[0] = 1;
    for (let b = 0; b < 400; b++) {
      const out = [[new Float32Array(128), new Float32Array(128)]];
      proc.process([[b === 0 ? impulse : new Float32Array(128), new Float32Array(128)]], out);
      for (let i = 0; i < 128; i++) if (b * 128 + i > 0 && out[0][0][i] > 0.5) return b * 128 + i;
    }
    return -1;
  };
  assert.equal(echoAt(120), 22050, 'a quarter note at 120 BPM is 0.5 s');
  assert.equal(echoAt(60), 44100);
});

test('instrument voices get the transport with a running beat position', () => {
  const p = parsePlugin('/* @astudio-plugin\n * @id beat\n * @name Beat\n */ let seen = null; registerVoice(class { process(l, r, params, transport) { seen = transport; globalThis.__seen = transport; return true; } });');
  const { proc, render } = loadProcessor(p, { params: {}, transport: { bpm: 120, playing: true, position: 0, at: 0 }, events: [{ id: 1, frame: 0, key: 60, freq: 261.63, vel: 1, dur: Infinity }] });
  render(345); // about 1 second
  assert.equal(globalThis.__seen.bpm, 120);
  assert.ok(Math.abs(globalThis.__seen.beat - 2) < 0.05, 'two beats after one second at 120 BPM');
  proc.port.onmessage({ data: { type: 'transport', bpm: 90, playing: false, position: 0, at: 0 } });
  render(1);
  assert.equal(globalThis.__seen.bpm, 90);
  assert.equal(globalThis.__seen.playing, false);
});

test('the catalog lists valid entries that point to existing example files', async () => {
  const cat = JSON.parse(readFileSync(new URL('../public/plugins/catalog.json', import.meta.url), 'utf8'));
  for (const e of [...cat.plugins, ...cat.themes]) {
    assert.match(e.url, /^https:\/\/raw\.githubusercontent\.com\/kurodaki-dev\/A-studio\/main\/public\/doc\/examples\//);
    const file = e.url.split('/').pop();
    const text = readFileSync(new URL('../public/doc/examples/' + file, import.meta.url), 'utf8');
    if (file.endsWith('.js')) {
      const p = parsePlugin(text);
      assert.equal(p.id, e.id);
      assert.equal(p.type, e.type);
    }
  }
});

test('AI Connect handles every tool of the MCP bridge', () => {
  const plugin = parsePlugin(ex('ai-connect.astudio-plugin.js'));
  assert.equal(plugin.type, 'extension');
  assert.deepEqual(plugin.permissions, ['ui', 'transport', 'project-read', 'project-write', 'audio', 'network']);
  const server = readFileSync(new URL('../mcp-server/src/server.js', import.meta.url), 'utf8');
  const bridgeTools = [...server.matchAll(/tool\('([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(bridgeTools.length >= 12);
  const toolsBlock = /const TOOLS = \{([\s\S]*?)\n\};/.exec(plugin.code)[1];
  const handled = [...toolsBlock.matchAll(/^\s+(?:async\s+)?([a-z_]+)[:(]/gm)].map((m) => m[1]);
  for (const name of bridgeTools) assert.ok(handled.includes(name), 'plugin misses ' + name);
});
