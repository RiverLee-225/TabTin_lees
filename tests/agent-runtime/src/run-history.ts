/**
 * 运行台账：每回放一条 case 追加一行 JSONL 到 reports/run-history.jsonl。
 *
 * 这是 TestLab Phase 2「展示运行历史」的数据层雏形——统计通过率、
 * 翻某条 case 的历史、给 UI 供数都从这个文件读。
 * 写失败不抛错（台账是可观测性，不阻断测试主流程）。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RunRecord {
  timestamp: string;
  caseId: string;
  fixtureDir: string;
  /** replay = 正常回归；record = REPLAY_RECORD=1 重录 baseline */
  mode: 'replay' | 'record';
  passed: boolean;
  durationMs: number;
  invariantFailures: string[];
  snapshotDiffs: string[];
  warnings: string[];
}

export const DEFAULT_HISTORY_FILE = path.join(
  import.meta.dirname,
  '..',
  'reports',
  'run-history.jsonl',
);

export function appendRunRecord(record: RunRecord, historyFile = DEFAULT_HISTORY_FILE): void {
  try {
    fs.mkdirSync(path.dirname(historyFile), { recursive: true });
    fs.appendFileSync(historyFile, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    console.warn(`[run-history] 写入失败: ${(err as Error)?.message ?? err}`);
  }
}
