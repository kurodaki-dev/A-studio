import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_PLUGINS, pluginInfo, workerSource, cleanResult } from '../../voice/src/plugins.js';
import { cleanTheme, BUILTIN_THEMES } from '../../voice/src/themes.js';
import { makeNote } from '../../voice/src/store.js';

// Runs the worker source with a fake worker scope.
function runInScope(code, notes, ctx) {
  return new Promise((resolve) => {
    const self = { postMessage: resolve };
    new Function('self', workerSource(code))(self);
    self.onmessage({ data: { notes, ctx } });
  });
}

test('built-in plugins run and their results are checked', async () => {
  const ctx = { ppq: 480, bpm: 120, beats: 4, selection: false };
  const notes = [makeNote(0, 60, 960, 'か'), makeNote(960, 62, 240, 'き')];
  for (const p of BUILTIN_PLUGINS) {
    const info = pluginInfo(p.code);
    assert.ok(info.name.length > 2);
    const r = await runInScope(p.code, notes, ctx);
    assert.ok(r.ok, info.name + ': ' + r.error);
    assert.equal(cleanResult(r.notes).length, 2);
  }
  const vib = await runInScope(BUILTIN_PLUGINS[0].code, notes, ctx);
  assert.equal(vib.notes[0].vib.depth, 45);
  assert.equal(vib.notes[1].vib.depth, 0);
  const bad = await runInScope('// @name Bad\nexport default function run() { throw new Error("boom"); }', notes, ctx);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /boom/);
  assert.throws(() => pluginInfo('export default () => []'), /@name/);
  assert.throws(() => cleanResult([{ t: 'x' }]));
  assert.throws(() => cleanResult(5));
  assert.equal(cleanResult([{ t: 10.4, key: 300, len: 1 }])[0].key, 127);
});

test('imported themes are checked', () => {
  const th = cleanTheme({ name: 'Mine', colors: { bg: '#000000', accent: 'red' } });
  assert.equal(th.colors.bg, '#000000');
  assert.equal(th.colors.accent, BUILTIN_THEMES[0].colors.accent);
  assert.throws(() => cleanTheme({ colors: {} }));
});
