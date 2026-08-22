import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  ensureCentrifugoBinary,
  resolveCentrifugoDownloadUrls,
} from './centrifugo.mjs';

test('CN Centrifugo downloads try the mirror before GitHub', () => {
  const urls = resolveCentrifugoDownloadUrls({
    region: 'cn',
    asset: 'centrifugo_6.6.2_windows_amd64.zip',
  });

  assert.equal(urls.length, 2);
  assert.match(urls[0], /^https:\/\/gh-proxy\.com\//);
  assert.match(urls[1], /^https:\/\/github\.com\//);
});

test('failed CN mirror falls back to GitHub without throwing', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tabtin-centrifugo-'));
  const binaryPath = path.join(
    rootDir,
    'scripts',
    'backend',
    'bin',
    'centrifugo.exe',
  );
  const attemptedUrls = [];
  let extracted = false;

  const result = await ensureCentrifugoBinary({
    rootDir,
    platform: 'win32',
    arch: 'x64',
    region: 'cn',
    existsSyncImpl: (candidate) => candidate === binaryPath && extracted,
    commandOutputImpl: () => (extracted ? 'v6.6.2' : null),
    downloadImpl: async (url) => {
      attemptedUrls.push(url);
      if (attemptedUrls.length === 1) throw new Error('mirror unavailable');
    },
    extractImpl: async () => {
      extracted = true;
    },
  });

  assert.equal(result.available, true);
  assert.equal(result.downloaded, true);
  assert.equal(attemptedUrls.length, 2);
  assert.match(attemptedUrls[0], /gh-proxy\.com/);
  assert.match(attemptedUrls[1], /github\.com/);
});
