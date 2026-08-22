import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectCommunityDoctorChecks,
  createCommunityDoctorRuntimeContext,
} from './doctor.mjs';

test('failed required checks send users back to the self-contained community entry', () => {
  const context = {
    backendAlreadyHealthy: false,
    centrifugoBinary: '/repo/scripts/backend/bin/centrifugo',
    centrifugoBinaryOk: false,
    commands: new Set(),
    dockerReady: false,
    nodeVersion: 'v0.0.0',
    packageManager: 'pnpm@0.0.0',
    platform: 'linux',
    region: 'auto',
  };
  const failedRequiredChecks = collectCommunityDoctorChecks(context).filter(
    ({ ok, required }) => required && !ok,
  );

  assert.ok(failedRequiredChecks.length > 0);
  for (const check of failedRequiredChecks) {
    assert.match(check.remediation, /node scripts\/dev\.mjs community/);
    assert.doesNotMatch(
      check.remediation,
      /community --doctor|rerun the doctor/i,
    );
  }

  const corepackPnpm = collectCommunityDoctorChecks({
    ...context,
    commands: new Set(['corepack']),
    corepackPnpmVersion: '8.0.0',
  }).find(({ id }) => id === 'pnpm');

  assert.equal(corepackPnpm.ok, false);
  assert.match(corepackPnpm.remediation, /node scripts\/dev\.mjs community/);
});

test('missing host Centrifugo is an optional warning for Community Dev', () => {
  const context = createCommunityDoctorRuntimeContext({
    rootDir: '/repo',
    platform: 'linux',
    commandExists: () => true,
    commandOutput: () => 'ok',
    existsSync: () => false,
  });
  const centrifugo = collectCommunityDoctorChecks(context).find(
    (check) => check.id === 'centrifugo',
  );

  assert.equal(centrifugo.ok, false);
  assert.equal(centrifugo.required, false);
  assert.match(centrifugo.summary, /Docker image/);
});

test('healthy Docker Centrifugo passes without a host binary', () => {
  const context = createCommunityDoctorRuntimeContext({
    rootDir: '/repo',
    platform: 'linux',
    commandExists: () => true,
    commandOutput: () => 'ok',
    existsSync: () => false,
  });
  context.backendAlreadyHealthy = true;
  const centrifugo = collectCommunityDoctorChecks(context).find(
    (check) => check.id === 'centrifugo',
  );

  assert.equal(centrifugo.ok, true);
  assert.equal(centrifugo.required, false);
  assert.match(centrifugo.summary, /Docker image/);
});

test('backend reconciliation still requires Docker when an old backend is healthy', () => {
  const checks = collectCommunityDoctorChecks({
    platform: 'darwin',
    nodeVersion: process.version,
    packageManager: 'pnpm@10.0.0',
    commands: new Set(['node', 'pnpm', 'python3', 'go']),
    xcodeSelectPath: true,
    dockerReady: false,
    backendAlreadyHealthy: true,
    backendReconciliationRequired: true,
    centrifugoBinaryOk: false,
  });

  const docker = checks.find((check) => check.id === 'docker');
  assert.deepEqual(
    { ok: docker.ok, required: docker.required },
    { ok: false, required: true },
  );
  assert.match(docker.summary, /required to reconcile/i);
});
