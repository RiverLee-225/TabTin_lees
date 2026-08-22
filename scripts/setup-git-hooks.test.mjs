import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(
  new URL('./setup-git-hooks.mjs', import.meta.url),
);

test('prepare succeeds when the source directory is not a Git worktree', async (t) => {
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'tabtin-source-'));
  t.after(() => rm(sourceDir, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: sourceDir,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Skipping Git hooks setup/);
});

test('prepare configures the project hooks path inside a Git worktree', async (t) => {
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'tabtin-worktree-'));
  t.after(() => rm(sourceDir, { recursive: true, force: true }));

  const init = spawnSync('git', ['init', '--quiet'], {
    cwd: sourceDir,
    encoding: 'utf8',
  });
  assert.equal(init.status, 0, init.stderr);

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: sourceDir,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);

  const configuredPath = spawnSync(
    'git',
    ['config', '--get', 'core.hooksPath'],
    { cwd: sourceDir, encoding: 'utf8' },
  );
  assert.equal(configuredPath.status, 0, configuredPath.stderr);
  assert.equal(configuredPath.stdout.trim(), '.githooks');
});
