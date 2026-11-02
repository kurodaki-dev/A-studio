import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGithubUrl, rawUrl, findFiles, fetchText } from '../src/github.js';
import { FRAME_CSP, frameDoc } from '../src/extensions.js';

test('GitHub links are recognized', () => {
  assert.deepEqual(parseGithubUrl('https://github.com/me/synths'), { kind: 'dir', owner: 'me', repo: 'synths', ref: null, path: '' });
  assert.deepEqual(parseGithubUrl('github.com/me/synths.git'), { kind: 'dir', owner: 'me', repo: 'synths', ref: null, path: '' });
  assert.deepEqual(parseGithubUrl('https://github.com/me/synths/tree/main/plugins/pads'), { kind: 'dir', owner: 'me', repo: 'synths', ref: 'main', path: 'plugins/pads' });
  assert.deepEqual(parseGithubUrl('https://github.com/me/synths/blob/v2/lead.astudio-plugin.js'), { kind: 'file', owner: 'me', repo: 'synths', ref: 'v2', path: 'lead.astudio-plugin.js' });
  assert.deepEqual(parseGithubUrl('https://raw.githubusercontent.com/me/synths/main/a/b.astudio-theme.json'), { kind: 'file', owner: 'me', repo: 'synths', ref: 'main', path: 'a/b.astudio-theme.json' });
  assert.equal(rawUrl({ owner: 'me', repo: 'synths', ref: 'main', path: 'a b/c.astudio-plugin.js' }), 'https://raw.githubusercontent.com/me/synths/main/a%20b/c.astudio-plugin.js');
});

test('other links are refused', () => {
  for (const bad of ['', 'http://github.com/me/x', 'https://gitlab.com/me/x', 'https://github.com/me', 'https://github.com/me/x/issues', 'https://evil.com/github.com/me/x', 'https://github.com/me/%2E%2E', 'javascript:alert(1)']) {
    assert.throws(() => parseGithubUrl(bad), bad);
  }
});

test('a repository is scanned for plugins and themes, then its plugins folder', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => body });
    if (url === 'https://api.github.com/repos/me/synths/contents') return ok([{ type: 'file', name: 'README.md', path: 'README.md', download_url: 'https://raw.githubusercontent.com/me/synths/main/README.md' }]);
    if (url === 'https://api.github.com/repos/me/synths/contents/plugins') {
      return ok([
        { type: 'file', name: 'pad.astudio-plugin.js', path: 'plugins/pad.astudio-plugin.js', download_url: 'https://raw.githubusercontent.com/me/synths/main/plugins/pad.astudio-plugin.js' },
        { type: 'file', name: 'dark.astudio-theme.json', path: 'plugins/dark.astudio-theme.json', download_url: 'https://raw.githubusercontent.com/me/synths/main/plugins/dark.astudio-theme.json' },
        { type: 'file', name: 'evil.astudio-plugin.js', path: 'plugins/evil.astudio-plugin.js', download_url: 'https://evil.example/evil.js' },
        { type: 'dir', name: 'more', path: 'plugins/more' },
      ]);
    }
    return { ok: false, status: 404 };
  };
  const files = await findFiles('https://github.com/me/synths');
  assert.deepEqual(files.map((f) => f.kind + ':' + f.name), ['plugin:pad.astudio-plugin.js', 'theme:dark.astudio-theme.json']);
  assert.deepEqual(calls, ['https://api.github.com/repos/me/synths/contents', 'https://api.github.com/repos/me/synths/contents/plugins']);
  await assert.rejects(findFiles('https://github.com/me/missing'), /not found/);
  await assert.rejects(findFiles('https://github.com/me/synths/blob/main/README.md'), /must end with/);
  await assert.rejects(fetchText('https://evil.example/x.js'), /raw.githubusercontent.com/);
});

test('extension frames get a policy without network access', () => {
  assert.match(FRAME_CSP, /default-src 'none'/);
  assert.doesNotMatch(FRAME_CSP, /connect-src/);
  assert.ok(frameDoc('x').indexOf('Content-Security-Policy') < frameDoc('x').indexOf('<script>'));
});
