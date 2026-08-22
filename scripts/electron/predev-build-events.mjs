export const PREDEV_SEED_READY_PREFIX = '[predev-build][seed-ready]';

export function formatPredevSeedReady(seed) {
  return `${PREDEV_SEED_READY_PREFIX} ${seed}`;
}

export function parsePredevSeedReady(line) {
  const prefix = `${PREDEV_SEED_READY_PREFIX} `;
  if (!line.startsWith(prefix)) return null;
  return line.slice(prefix.length).trim() || null;
}
