import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFromTag, newerRelease } from '../src/version.js';

const url = 'https://github.com/kurodaki-dev/A-studio/releases/download/v1.0.12/A-Studio.apk';
const rel = (over = {}) => ({
  tag_name: 'v1.0.12',
  draft: false,
  prerelease: false,
  body: 'notes',
  assets: [{ name: 'A-Studio.apk', browser_download_url: url, size: 4000000 }],
  ...over,
});

test('build number from tag', () => {
  assert.equal(buildFromTag('v1.0.12'), 12);
  assert.equal(buildFromTag('v2.3.140'), 140);
  assert.equal(buildFromTag('nightly'), 0);
  assert.equal(buildFromTag(undefined), 0);
});

test('offers a newer release with its APK', () => {
  const r = newerRelease(rel(), 5);
  assert.equal(r.build, 12);
  assert.equal(r.version, '1.0.12');
  assert.equal(r.url, url);
});

test('ignores same, older, draft, prerelease or foreign releases', () => {
  assert.equal(newerRelease(rel(), 12), null);
  assert.equal(newerRelease(rel(), 30), null);
  assert.equal(newerRelease(rel({ draft: true }), 1), null);
  assert.equal(newerRelease(rel({ prerelease: true }), 1), null);
  assert.equal(newerRelease(rel({ assets: [] }), 1), null);
  assert.equal(newerRelease(rel({ assets: [{ name: 'A-Studio.apk', browser_download_url: 'https://evil.example/x.apk' }] }), 1), null);
  assert.equal(newerRelease(null, 1), null);
});
