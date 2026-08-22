/**
 * 通用 Replay 回归 runner——回放驱动**真实** agent-runtime 引擎。
 *
 * 自动发现 fixtures/ 下所有 Replay Case，逐个回放并断言。
 * 重录 baseline：REPLAY_RECORD=1 ./run.sh
 */

import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { discoverFixtureDirs } from '../src/fixture-types.js';
import { runReplayCase } from '../src/replay-runner.js';

const FIXTURES_ROOT = path.join(import.meta.dirname, '..', 'fixtures');
const fixtureDirs = discoverFixtureDirs(FIXTURES_ROOT);

describe('Replay 回归（真实 agent-runtime 引擎）', () => {
  it('至少存在一条 Replay Case', () => {
    expect(fixtureDirs.length).toBeGreaterThan(0);
  });

  for (const dir of fixtureDirs) {
    const caseName = path.basename(dir);
    it(`回放 ${caseName}`, async () => {
      const result = await runReplayCase(dir);

      for (const w of result.warnings) {
        console.warn(`[${caseName}] ${w}`);
      }

      expect(result.invariantFailures, '协议不变量失败').toEqual([]);
      if (!result.recorded) {
        expect(result.snapshotDiffs, '归一化快照漂移').toEqual([]);
      }
    });
  }
});
