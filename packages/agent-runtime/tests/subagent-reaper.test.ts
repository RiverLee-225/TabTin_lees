/**
 * subagent-reaper.test.ts — W4b orphan reaper（`reapOrphanedSubagentRuns`）回归
 *
 * 测什么：
 *   - 崩溃残留的「孤儿」run（started 无 ended，非活）→ reconcile 成 cancelled、runSeq 对齐
 *   - 本进程正在跑的子（started 无 ended，但 isStillActive=true）→ **绝不误杀**
 *   - 正常已结束的 run → 不动
 *   - 幂等（reap 两次，第二次返回 0）
 *   - resume 孤儿（最新 run started 无 ended，旧 run 已 completed）→ 只 reconcile 最新 run
 *   - subagents.jsonl 不存在 → 返回 0 不抛
 *
 * 测试策略：tmp 目录用 SubagentIndexWriter 写真 subagents.jsonl，调
 * reapOrphanedSubagentRuns（pure helper），再用 foldSubagentRuns 验证终态。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  SubagentIndexWriter,
  readSubagentIndexEntries,
  foldSubagentRuns,
  reapOrphanedSubagentRuns,
} from '../src/session/index.js';

const PARENT = 'parent-session-reaper-test';
const CHILD_ORPHAN = 'aaaaaaaa-1111-2222-3333-444444444444';
const CHILD_ALIVE = 'bbbbbbbb-1111-2222-3333-444444444444';
const CHILD_DONE = 'cccccccc-1111-2222-3333-444444444444';

let workdir: string;
let parentSessionDir: string;

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabtin-reaper-'));
  parentSessionDir = path.join(workdir, 'sessions');
  fs.mkdirSync(parentSessionDir, { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(workdir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

function makePaths(childId: string) {
  return {
    sessionDir: `subagents/agent-${childId}`,
    messagesPath: `subagents/agent-${childId}/messages.jsonl`,
    snapshotsPath: `subagents/agent-${childId}/snapshots.jsonl`,
    eventsPath: `subagents/agent-${childId}/events.jsonl`,
  };
}

async function writeStart(
  w: SubagentIndexWriter,
  childId: string,
  opts: { runSeq?: number; createdAt?: number; parentToolCallId?: string } = {},
): Promise<void> {
  await w.recordStart({
    subSessionId: `agent-${childId}`,
    childId,
    shortId: childId.slice(0, 4),
    runSeq: opts.runSeq,
    task: 'demo task',
    model: 'claude-test',
    createdAt: opts.createdAt ?? 1_000_000,
    paths: makePaths(childId),
    ...(opts.parentToolCallId ? { parentToolCallId: opts.parentToolCallId } : {}),
  });
}

async function writeEnd(
  w: SubagentIndexWriter,
  childId: string,
  opts: { runSeq?: number; status?: 'completed' | 'failed' | 'cancelled'; endedAt?: number } = {},
): Promise<void> {
  await w.recordEnd({
    subSessionId: `agent-${childId}`,
    childId,
    runSeq: opts.runSeq,
    status: opts.status ?? 'completed',
    endedAt: opts.endedAt ?? 1_005_000,
    finalTextLength: 10,
    durationMs: 5_000,
  });
}

const NONE_ACTIVE = (): boolean => false;

describe('reapOrphanedSubagentRuns', () => {
  it('孤儿（started 无 ended，非活）→ reconcile 成 cancelled', async () => {
    const w = new SubagentIndexWriter(parentSessionDir, PARENT);
    await writeStart(w, CHILD_ORPHAN);

    const n = await reapOrphanedSubagentRuns(parentSessionDir, PARENT, NONE_ACTIVE);
    expect(n).toBe(1);

    const folded = foldSubagentRuns(await readSubagentIndexEntries(parentSessionDir, PARENT));
    expect(folded.find((r) => r.childId === CHILD_ORPHAN)?.status).toBe('cancelled');
  });

  it('本进程正在跑的子（isStillActive=true）→ 绝不误杀', async () => {
    const w = new SubagentIndexWriter(parentSessionDir, PARENT);
    await writeStart(w, CHILD_ALIVE);

    const aliveSet = new Set([CHILD_ALIVE]);
    const n = await reapOrphanedSubagentRuns(parentSessionDir, PARENT, (id) => aliveSet.has(id));
    expect(n).toBe(0);

    const folded = foldSubagentRuns(await readSubagentIndexEntries(parentSessionDir, PARENT));
    expect(folded.find((r) => r.childId === CHILD_ALIVE)?.status).toBe('running');
  });

  it('正常已结束的 run → 不动', async () => {
    const w = new SubagentIndexWriter(parentSessionDir, PARENT);
    await writeStart(w, CHILD_DONE);
    await writeEnd(w, CHILD_DONE, { status: 'completed' });

    const n = await reapOrphanedSubagentRuns(parentSessionDir, PARENT, NONE_ACTIVE);
    expect(n).toBe(0);

    const folded = foldSubagentRuns(await readSubagentIndexEntries(parentSessionDir, PARENT));
    expect(folded.find((r) => r.childId === CHILD_DONE)?.status).toBe('completed');
  });

  it('幂等：reap 两次，第二次返回 0', async () => {
    const w = new SubagentIndexWriter(parentSessionDir, PARENT);
    await writeStart(w, CHILD_ORPHAN);

    expect(await reapOrphanedSubagentRuns(parentSessionDir, PARENT, NONE_ACTIVE)).toBe(1);
    expect(await reapOrphanedSubagentRuns(parentSessionDir, PARENT, NONE_ACTIVE)).toBe(0);
  });

  it('resume 孤儿：最新 run（runSeq=2）无 ended、run1 已 completed → 只 reconcile 最新 run', async () => {
    const w = new SubagentIndexWriter(parentSessionDir, PARENT);
    await writeStart(w, CHILD_ORPHAN, { runSeq: 1, createdAt: 1_000_000 });
    await writeEnd(w, CHILD_ORPHAN, { runSeq: 1, status: 'completed', endedAt: 1_005_000 });
    await writeStart(w, CHILD_ORPHAN, { runSeq: 2, createdAt: 2_000_000 });

    const n = await reapOrphanedSubagentRuns(parentSessionDir, PARENT, NONE_ACTIVE);
    expect(n).toBe(1);

    const folded = foldSubagentRuns(await readSubagentIndexEntries(parentSessionDir, PARENT));
    const run = folded.find((r) => r.childId === CHILD_ORPHAN);
    expect(run?.status).toBe('cancelled');
    expect(run?.runSeq).toBe(2);
  });

  it('subagents.jsonl 不存在 → 返回 0（不抛）', async () => {
    const n = await reapOrphanedSubagentRuns(parentSessionDir, 'no-such-session', NONE_ACTIVE);
    expect(n).toBe(0);
  });

  it('孤儿收口写入父 message-blocks 的 cancelled tool_result', async () => {
    const w = new SubagentIndexWriter(parentSessionDir, PARENT);
    await writeStart(w, CHILD_ORPHAN, { parentToolCallId: 'call_orphan_1' });
    const { MessageBlockStorage } = await import('../src/session/message-block-storage.js');
    const storage = new MessageBlockStorage(parentSessionDir, PARENT);
    await storage.append({
      v: 1,
      recorded_at: '2026-08-01T00:00:00.000Z',
      message_id: 'asst-dispatch',
      role: 'assistant',
      message_kind: 'llm',
      blocks_json: [
        { type: 'tool_use', id: 'call_orphan_1', name: 'agent', input: { prompt: '调研' } },
      ],
    });
    await storage.flushPendingWrites();

    expect(await reapOrphanedSubagentRuns(parentSessionDir, PARENT, NONE_ACTIVE)).toBe(1);

    const records = await new MessageBlockStorage(parentSessionDir, PARENT).load();
    expect(records).toHaveLength(1);
    expect(records[0].message_id).toBe('asst-dispatch');
    const result = records[0].blocks_json.find((block) => (
      block && typeof block === 'object' && (block as { type?: string }).type === 'tool_result'
    )) as {
      tool_use_id?: string
      presentation?: { kind?: string; data?: { status?: string; subagent_run_id?: string } }
    } | undefined;
    expect(result?.tool_use_id).toBe('call_orphan_1');
    expect(result?.presentation).toEqual({
      kind: 'subagent_result',
      data: { subagent_run_id: CHILD_ORPHAN, status: 'cancelled' },
    });
  });

  it('找不到派发 tool_use 时仍落独立 cancelled tool_artifact', async () => {
    const w = new SubagentIndexWriter(parentSessionDir, PARENT);
    await writeStart(w, CHILD_ORPHAN, { parentToolCallId: 'call_orphan_detached' });

    expect(await reapOrphanedSubagentRuns(parentSessionDir, PARENT, NONE_ACTIVE)).toBe(1);

    const { MessageBlockStorage } = await import('../src/session/message-block-storage.js');
    const records = await new MessageBlockStorage(parentSessionDir, PARENT).load();
    expect(records).toHaveLength(1);
    expect(records[0].message_kind).toBe('tool_artifact');
    expect(records[0].blocks_json[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'call_orphan_detached',
      presentation: {
        kind: 'subagent_result',
        data: { subagent_run_id: CHILD_ORPHAN, status: 'cancelled' },
      },
    });
  });
});
