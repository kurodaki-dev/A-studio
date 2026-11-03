import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceAsset, VOICE_APK } from '../src/voiceStudio.js';
import { newerRelease } from '../src/version.js';

test('the extension APK is found in a release, A Studio keeps its own APK', () => {
  const base = 'https://github.com/kurodaki-dev/A-studio/releases/download/v1.0.60/';
  const rel = { tag_name: 'v1.0.60', assets: [{ name: 'A-Studio.apk', browser_download_url: base + 'A-Studio.apk', size: 9e6 }, { name: VOICE_APK, browser_download_url: base + VOICE_APK, size: 8e6 }] };
  assert.deepEqual(voiceAsset(rel), { url: base + VOICE_APK, size: 8e6, version: '1.0.60' });
  assert.equal(newerRelease(rel, 59).url, base + 'A-Studio.apk');
  assert.equal(voiceAsset({ assets: [{ name: VOICE_APK, browser_download_url: 'https://evil.example/x.apk' }] }), null);
  assert.equal(voiceAsset(null), null);
});
