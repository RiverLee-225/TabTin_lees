/**
 * session → Replay Case fixture 导出器。
 *
 * 用法（在 tests/agent-runtime 目录下）：
 *   ../../node_modules/.bin/tsx src/export-replay-fixture.ts \
 *     --session-id <sessionId> \
 *     --case-id BASE_003 \
 *     --title "用例标题" \
 *     [--run-id <runId>] [--module "..."] [--priority P0] [--out fixtures]
 *   ../../node_modules/.bin/tsx src/export-replay-fixture.ts \
 *     --session-id <sessionId> \
 *     --all-runs \
 *     --case-prefix BASE_004 \
 *     --title-prefix "用例标题"
 *
 * 导出后跑 REPLAY_RECORD=1 ./run.sh 生成 expected.json baseline。
 */

import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// tsx 下 import.meta.dirname 可能为 undefined，用 fileURLToPath 兜底。
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES_DIR = path.join(SCRIPT_DIR, '..', 'fixtures');

import type { ContentBlock, LLMResponseChunk, ToolUseBlock } from './runtime-adapter.js';
import {
  writeJsonPretty,
  writeJsonl,
  type ReplayContext,
  type ReplayLLMTurn,
  type ReplayManifest,
  type ReplayToolResult,
} from './fixture-types.js';
import { stableHash } from './normalize.js';
import { buildRequestSummaryFromParts } from './request-summary.js';
import {
  findSessionDir,
  parseSnapshots,
  parseTranscript,
  rebuildSystemPrompt,
  snapshotMessageToMessage,
  snapshotToolsToDefinitions,
  type SnapshotTurnPair,
} from './session-import.js';

// ─── response → LLMResponseChunk[] 合成 ─────────────────────────────
// runtime 会把 text_delta 逐段累积，chunk 粒度对回放语义无影响，
// 因此从最终 assistant content blocks 合成 chunk 序列是无损的。

function synthesizeResponseChunks(pair: SnapshotTurnPair): LLMResponseChunk[] {
  const enriched = pair.enriched;
  if (!enriched?.response) {
    throw new Error(
      `iteration ${pair.iteration} 缺少带 response 的增强快照——该轮 LLM 调用可能中断，此 session 不适合做 Replay Case`,
    );
  }
  const resp = enriched.response;
  const chunks: LLMResponseChunk[] = [];

  if (resp.format === 'text') {
    chunks.push({ type: 'text_delta', text: resp.contentPreview });
  } else {
    const blocks = JSON.parse(resp.contentPreview) as ContentBlock[];
    for (const block of blocks) {
      switch (block.type) {
        case 'thinking':
          chunks.push({ type: 'thinking', thinking: block.thinking });
          break;
        case 'text':
          chunks.push({ type: 'text_delta', text: block.text });
          break;
        case 'tool_use':
          chunks.push({
            type: 'tool_use',
            toolUse: { id: block.id, name: block.name, input: block.input },
          });
          break;
        default:
          throw new Error(`响应含未支持的块类型: ${(block as { type: string }).type}`);
      }
    }
  }
  chunks.push({ type: 'stop', stopReason: (resp.stopReason ?? 'end_turn') as 'end_turn' });
  return chunks;
}

function currentGitCommit(): string | null {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: SCRIPT_DIR,
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

// ─── 主流程 ─────────────────────────────────────────────────────────

export interface ExportOptions {
  sessionDir: string;
  caseId: string;
  title: string;
  module: string;
  priority: string;
  outDir: string;
  /** session 含多次 run 时指定导哪一次；缺省取第一次。 */
  runId?: string;
  /** 展示/追踪用：该 run 在当前 session 主链路中的 1-based 顺序。 */
  runIndex?: number;
  acceptedBy?: string | null;
  acceptanceSummary?: string;
}

function discoverMainRunIds(sessionDir: string): string[] {
  const pairs = parseSnapshots(path.join(sessionDir, 'snapshots.jsonl'));
  const allMainPairs = pairs.filter((p) => p.request.requestSource === '_main_chat');
  if (allMainPairs.length === 0) throw new Error('session 中没有 _main_chat 的 LLM 调用记录');
  return [...new Set(allMainPairs.map((p) => p.request.runId))];
}

function formatRunCaseId(casePrefix: string, index: number): string {
  return `${casePrefix}_${String(index).padStart(2, '0')}`;
}

export function exportReplayFixture(opts: ExportOptions): string {
  const sessionId = path.basename(opts.sessionDir);
  const fixtureDir = path.join(opts.outDir, opts.caseId);

  const transcript = parseTranscript(path.join(opts.sessionDir, 'messages.jsonl'));
  const pairs = parseSnapshots(path.join(opts.sessionDir, 'snapshots.jsonl'));
  // 本 MVP 只回放主链路；compact / subagent 轮次后续扩展
  const allMainPairs = pairs.filter((p) => p.request.requestSource === '_main_chat');
  if (allMainPairs.length === 0) throw new Error('session 中没有 _main_chat 的 LLM 调用记录');

  // 一条 Replay Case = 一次 run（一轮完整 ReAct 循环）。同一 session 里
  // 用户每发一条消息就是一个新 runId——多 run 混导会让回放在第一个
  // end_turn 后剩下未消费轮次，必须拆开。
  const runIds = [...new Set(allMainPairs.map((p) => p.request.runId))];
  const selectedRunId = opts.runId ?? runIds[0]!;
  if (!runIds.includes(selectedRunId)) {
    throw new Error(`session 中不存在 runId ${selectedRunId}；可选: ${runIds.join(', ')}`);
  }
  if (runIds.length > 1 && !opts.runId) {
    console.warn(
      `[export] 该 session 包含 ${runIds.length} 次独立 run，默认导出第一次 (${selectedRunId})。` +
        `\n         其它 run 可用 --run-id 指定: ${runIds.slice(1).join(', ')}`,
    );
  }
  const mainPairs = allMainPairs.filter((p) => p.request.runId === selectedRunId);

  const first = mainPairs[0]!.request;
  const system = rebuildSystemPrompt(first);
  const tools = snapshotToolsToDefinitions(first);

  // ── context.json：引擎启动上下文 = iter0 请求快照里的完整消息列表 ──
  const initialMessages = first.messages.map(snapshotMessageToMessage);
  const context: ReplayContext = {
    system,
    initialMessages,
    model: first.model,
    maxTokens: first.maxTokens,
    requestSource: first.requestSource,
  };

  // ── llm-turns.jsonl ──
  const turns: ReplayLLMTurn[] = mainPairs.map((pair) => {
    const reqMessages = pair.request.messages.map(snapshotMessageToMessage);
    return {
      iteration: pair.iteration,
      requestSource: pair.request.requestSource,
      requestSummary: buildRequestSummaryFromParts({
        model: pair.request.model,
        maxTokens: pair.request.maxTokens,
        system,
        messages: reqMessages,
        tools,
      }),
      responseChunks: synthesizeResponseChunks(pair),
    };
  });

  // ── tool-results.jsonl：只导选中 run 实际发起的调用 ──
  const runToolCallIds = new Set<string>();
  for (const turn of turns) {
    for (const chunk of turn.responseChunks) {
      if (chunk.type === 'tool_use') runToolCallIds.add(chunk.toolUse.id);
    }
  }
  const toolUseById = new Map<string, ToolUseBlock>();
  for (const msg of transcript) {
    if (typeof msg.content === 'string') continue;
    for (const block of msg.content) {
      if (block.type === 'tool_use') toolUseById.set(block.id, block);
    }
  }
  const toolResults: ReplayToolResult[] = [];
  for (const msg of transcript) {
    if (typeof msg.content === 'string') continue;
    for (const block of msg.content) {
      if (block.type !== 'tool_result') continue;
      if (!runToolCallIds.has(block.tool_use_id)) continue;
      const use = toolUseById.get(block.tool_use_id);
      if (!use) continue; // 孤儿 tool_result 不导出（真实 runtime 会拒绝）
      toolResults.push({
        toolCallId: block.tool_use_id,
        toolName: use.name,
        inputHash: stableHash(use.input),
        result: {
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          isError: block.is_error,
        },
      });
    }
  }

  // ── manifest.json ──
  const userInputs = first.messages.filter((m) => m.source === 'user_input');
  const currentUserInput = userInputs.at(-1);
  const manifest: ReplayManifest = {
    caseId: opts.caseId,
    title: opts.title,
    module: opts.module,
    priority: opts.priority,
    initialPrompt: currentUserInput?.contentPreview ?? '',
    preconditions: [],
    sourceSessionId: sessionId,
    sourceSessionDir: opts.sessionDir,
    sourceRunId: selectedRunId,
    sourceRunIndex: opts.runIndex ?? runIds.indexOf(selectedRunId) + 1,
    sourceCommit: currentGitCommit(),
    acceptedAt: new Date().toISOString(),
    acceptedBy: opts.acceptedBy ?? null,
    acceptanceSummary: opts.acceptanceSummary ?? '',
  };

  writeJsonPretty(path.join(fixtureDir, 'manifest.json'), manifest);
  writeJsonPretty(path.join(fixtureDir, 'context.json'), context);
  writeJsonPretty(path.join(fixtureDir, 'tools.json'), tools);
  writeJsonl(path.join(fixtureDir, 'llm-turns.jsonl'), turns);
  writeJsonl(path.join(fixtureDir, 'tool-results.jsonl'), toolResults);

  return fixtureDir;
}

// ─── CLI ────────────────────────────────────────────────────────────

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const { values } = parseArgs({
    options: {
      'session-id': { type: 'string' },
      'session-dir': { type: 'string' },
      'run-id': { type: 'string' },
      'case-id': { type: 'string' },
      'case-prefix': { type: 'string' },
      title: { type: 'string' },
      'title-prefix': { type: 'string' },
      module: { type: 'string', default: '未分类' },
      priority: { type: 'string', default: 'P1' },
      out: { type: 'string', default: DEFAULT_FIXTURES_DIR },
      'accepted-by': { type: 'string' },
      summary: { type: 'string' },
      'all-runs': { type: 'boolean', default: false },
    },
  });

  if (!values['session-id'] && !values['session-dir']) {
    console.error(
      '用法: tsx src/export-replay-fixture.ts --session-id <id>|--session-dir <dir> (--case-id <CASE_ID> --title "<标题>" | --all-runs --case-prefix <PREFIX> [--title-prefix "<标题前缀>"])',
    );
    process.exit(1);
  }

  const sessionDir = values['session-dir'] ?? findSessionDir(values['session-id']!);
  if (values['all-runs']) {
    if (values['run-id'] || values['case-id'] || values.title) {
      console.error('--all-runs 会自动选择全部 run 并生成 caseId；不要同时传 --run-id / --case-id / --title');
      process.exit(1);
    }
    if (!values['case-prefix']) {
      console.error('--all-runs 需要 --case-prefix <PREFIX>，例如 --case-prefix BASE_004');
      process.exit(1);
    }

    const runIds = discoverMainRunIds(sessionDir);
    const titlePrefix = values['title-prefix'] ?? values['case-prefix'];
    const fixtureDirs = runIds.map((runId, index) =>
      exportReplayFixture({
        sessionDir,
        caseId: formatRunCaseId(values['case-prefix']!, index + 1),
        title: `${titlePrefix} ${String(index + 1).padStart(2, '0')}`,
        module: values.module!,
        priority: values.priority!,
        outDir: values.out!,
        runId,
        runIndex: index + 1,
        acceptedBy: values['accepted-by'] ?? null,
        acceptanceSummary: values.summary,
      }),
    );
    console.log(`已从 session 导出 ${fixtureDirs.length} 条 Replay Case:`);
    for (const dir of fixtureDirs) console.log(`- ${dir}`);
    console.log(`下一步生成 baseline: REPLAY_RECORD=1 ./run.sh -t "回放 ${values['case-prefix']}"`);
    process.exit(0);
  }

  if (!values['case-id'] || !values.title) {
    console.error(
      '用法: tsx src/export-replay-fixture.ts --session-id <id>|--session-dir <dir> --case-id <CASE_ID> --title "<标题>"',
    );
    process.exit(1);
  }

  const fixtureDir = exportReplayFixture({
    sessionDir,
    caseId: values['case-id'],
    title: values.title,
    module: values.module!,
    priority: values.priority!,
    outDir: values.out!,
    runId: values['run-id'],
    acceptedBy: values['accepted-by'] ?? null,
    acceptanceSummary: values.summary,
  });
  console.log(`fixture 已导出: ${fixtureDir}`);
  console.log(`下一步生成 baseline: REPLAY_RECORD=1 ./run.sh`);
}
