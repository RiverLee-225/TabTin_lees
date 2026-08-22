import { spawnSync } from 'node:child_process';

const worktreeCheck = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
  encoding: 'utf8',
});

if (worktreeCheck.status !== 0 || worktreeCheck.stdout.trim() !== 'true') {
  console.log('Skipping Git hooks setup: not a Git worktree.');
  process.exit(0);
}

const configureHooks = spawnSync(
  'git',
  ['config', 'core.hooksPath', '.githooks'],
  { stdio: 'inherit' },
);

if (configureHooks.error) throw configureHooks.error;
process.exit(configureHooks.status ?? 1);
