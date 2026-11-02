import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DSP_LIB } from '../src/dsplib.js';
import { parsePlugin, moduleSource, pluginErrorLine } from '../src/plugins.js';

const dsp = new Function(DSP_LIB + '\nreturn dsp;')();
const SR = 48000;

test('dsp oscillators run at the right frequency and stay in range', () => {
  for (const wave of ['sine', 'saw', 'square', 'triangle']) {
    const o = new dsp.Osc(SR);
    let up = 0;
    let prev = 0;
    let peak = 0;
    for (let i = 0; i < SR; i++) {
      const s = o[wave](440);
      if (prev < 0 && s >= 0) up += 1;
      prev = s;
      if (i > 1000) peak = Math.max(peak, Math.abs(s));
    }
    assert.ok(Math.abs(up - 440) <= 2, wave + ' ' + up);
    assert.ok(peak <= 1.2 && peak > 0.5, wave + ' peak ' + peak);
  }
});

test('dsp filter, envelope, delay, smoothing and noise', () => {
  const lp = new dsp.Biquad(SR).set('lowpass', 500, 0.707);
  const hp = new dsp.Biquad(SR).set('highpass', 500, 0.707);
  const o = new dsp.Osc(SR);
  let pl = 0;
  let ph = 0;
  for (let i = 0; i < SR / 2; i++) {
    const x = o.sine(5000);
    const a = Math.abs(lp.process(x));
    const b = Math.abs(hp.process(x));
    if (i > SR / 4) { pl = Math.max(pl, a); ph = Math.max(ph, b); }
  }
  assert.ok(pl < 0.02, 'low pass lets 5 kHz through: ' + pl);
  assert.ok(ph > 0.95, 'high pass cuts 5 kHz: ' + ph);
  const env = new dsp.Env(SR, { attack: 0.01, decay: 0.05, sustain: 0.5, release: 0.05 });
  env.gate(true);
  let v = 0;
  for (let i = 0; i < SR * 0.01; i++) v = env.next();
  assert.ok(v > 0.95);
  for (let i = 0; i < SR * 0.3; i++) v = env.next();
  assert.ok(Math.abs(v - 0.5) < 0.01);
  env.gate(false);
  for (let i = 0; i < SR * 0.2 && !env.done; i++) env.next();
  assert.ok(env.done);
  const d = new dsp.Delay(SR, 1);
  for (let i = 0; i < 1000; i++) d.write(i === 100 ? 1 : 0);
  // The impulse written 900 samples ago reads back at that delay.
  assert.equal(d.read(900 / SR), 1);
  const sm = new dsp.Smooth(SR, 10, 0);
  let x = 0;
  for (let i = 0; i < SR * 0.05; i++) x = sm.next(1);
  assert.ok(x > 0.99);
  const n = new dsp.Noise(1);
  let mean = 0;
  for (let i = 0; i < 10000; i++) mean += n.white() / 10000;
  assert.ok(Math.abs(mean) < 0.05);
  assert.equal(dsp.mtof(69), 440);
  assert.ok(Math.abs(dsp.dbToGain(-6) - 0.501) < 0.001);
});

const PLUGIN = `/**
 * @astudio-plugin
 * @id err-test
 * @name Err Test
 * @version 1.0.0
 * @param a "A" 0 1 0.5
 */
class V {
  constructor() {}
  process(left) {
    throw new Error('boom');
  }
}
registerVoice(V);
`;

test('runtime errors are mapped to the line of the plugin file', () => {
  const p = parsePlugin(PLUGIN);
  const src = moduleSource(p);
  const userStart = src.split('\n').indexOf('// @astudio-user-code') + 2; // 1 based line of the first plugin line
  const throwLine = PLUGIN.split('\n').findIndex((l) => l.includes('boom')) + 1;
  const stack = 'Error: boom\n    at V.process (blob:http://localhost/abc:' + (userStart + throwLine - 1) + ':11)\n    at x (blob:http://localhost/abc:900:3)';
  assert.equal(pluginErrorLine(p, stack), throwLine);
  assert.equal(pluginErrorLine(p, ''), null);
  assert.equal(pluginErrorLine(p, 'Error\n    at blob:http://x/y:3:1'), null);
  // The generated module still runs the dsp library before the plugin code.
  assert.ok(src.indexOf('const dsp = ') < src.indexOf('class V'));
});
