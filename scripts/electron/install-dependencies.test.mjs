import assert from 'node:assert/strict';
import test from 'node:test';

import { buildElectronInstallPlan } from './install-dependencies.mjs';

test('normal Electron install is frozen, offline-preferred and never forced', () => {
  const plan = buildElectronInstallPlan('global');
  assert.ok(plan.args.includes('--frozen-lockfile'));
  assert.ok(plan.args.includes('--prefer-offline'));
  assert.ok(!plan.args.includes('--force'));
});

test('explicit repair mode is the only install plan that uses force', () => {
  const plan = buildElectronInstallPlan('global', { repair: true });
  assert.ok(plan.args.includes('--force'));
});
