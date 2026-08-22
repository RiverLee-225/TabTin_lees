/**
 * Replay runner——组装**真实** agent-runtime 引擎回放一条 Replay Case。
 *
 *   1. ReplayLLMProvider（假模型）+ ReplayToolProvider（假工具）+
 *      allow-all permission handler 注入 createRuntime()；
 *   2. runtime.query({ initialMessages }) 跑完整 ReAct 循环（生产 query.ts）；
 *   3. 从引擎 emit 的 envelope 事件流折叠出 transcript，两层断言：
 *      - 协议不变量（永远硬断言）：tool_use/tool_result 配对完整、
 *        lifecycle start/end 配对、done 事件存在、录制轮次全消费；
 *      - 归一化快照（可显式重录）：finalAssistantText / messagesShape /
 *        toolCalls 与 expected.json 逐项 diff。
 *
 * REPLAY_RECORD=1 时：跑完后把归一化快照写回 expected.json（baseline
 * 重录），默认模式绝不静默重写 fixture。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  createRuntime,
  createMockPermissionHandler,
  type ContentBlock,
  type Message,
  type StreamEvent,
} from './runtime-adapter.js';
import {
  loadFixture,
  writeJsonPretty,
  type ExpectedToolCall,
  type NormalizedSnapshot,
  type ReplayExpected,
  type ReplayFixture,
} from './fixture-types.js';
import { normalizeText } from './normalize.js';
import { appendRunRecord } from './run-history.js';
import { classifyMessage } from './request-summary.js';
import { ReplayLLMProvider } from './replay-llm-provider.js';
import { ReplayToolProvider } from './replay-tool-provider.js';

export interface ReplayCaseResult {
  caseId: string;
  passed: boolean;
  recorded: boolean;
  invariantFailures: string[];
  snapshotDiffs: string[];
  warnings: string[];
  actualSnapshot: NormalizedSnapshot;
}

// ─── 事件流 → transcript 折叠 ───────────────────────────────────────
// 6 件套 content_block 事件依赖 proxy-provider 的 envelope hint 回调，
// 回放 provider 不发 hint，所以拿不到。改用 `agent.stream.persist_message`
// （ A1）：query.ts 在每条消息「真正完整」的边界自己 emit，payload
// 携带全量 blocks_json（assistant blocks + 本轮 tool_result 已 co-locate），
// 与 provider 实现无关，是回放下消息结构的权威来源。

export function foldPersistedMessages(events: StreamEvent[]): Message[] {
  const messages: Message[] = [];
  for (const ev of events) {
    if (ev.type !== 'agent.stream.persist_message') continue;
    const p = ev.payload as {
      role?: 'user' | 'assistant';
      blocks_json?: unknown[];
      partial?: boolean;
    };
    if (!p.role || !Array.isArray(p.blocks_json)) continue;
    if (p.partial) continue; // 中断残片不进 transcript
    messages.push({ role: p.role, content: p.blocks_json as ContentBlock[] });
  }
  return messages;
}

// ─── 归一化快照构建 ─────────────────────────────────────────────────

function buildSnapshot(transcript: Message[]): NormalizedSnapshot {
  const messagesShape = transcript.map((m) => `${m.role}:${classifyMessage(m)}`);

  const toolCalls: ExpectedToolCall[] = [];
  let finalAssistantText = '';
  for (const msg of transcript) {
    if (typeof msg.content === 'string') {
      if (msg.role === 'assistant') finalAssistantText = msg.content;
      continue;
    }
    for (const block of msg.content) {
      if (block.type === 'tool_use') toolCalls.push({ name: block.name });
      if (block.type === 'text' && msg.role === 'assistant' && block.text.trim()) {
        finalAssistantText = block.text;
      }
    }
  }

  return {
    finalAssistantText: normalizeText(finalAssistantText),
    messagesShape,
    toolCalls,
  };
}

// ─── 不变量校验 ─────────────────────────────────────────────────────

function checkInvariants(
  transcript: Message[],
  currentRunMessages: Message[],
  events: StreamEvent[],
  llmProvider: ReplayLLMProvider,
  toolProvider: ReplayToolProvider,
): string[] {
  const failures: string[] = [];

  // 1. tool_use / tool_result 配对完整
  const useIds = new Set<string>();
  const resultIds = new Set<string>();
  for (const msg of transcript) {
    if (typeof msg.content === 'string') continue;
    for (const block of msg.content) {
      if (block.type === 'tool_use') useIds.add(block.id);
      if (block.type === 'tool_result') resultIds.add(block.tool_use_id);
    }
  }
  for (const id of useIds) {
    if (!resultIds.has(id)) failures.push(`tool_use ${id} 缺少配对的 tool_result`);
  }
  for (const id of resultIds) {
    if (!useIds.has(id)) failures.push(`tool_result ${id} 是孤儿（找不到对应 tool_use）`);
  }

  const currentRunToolUseIds = new Set<string>();
  for (const msg of currentRunMessages) {
    if (typeof msg.content === 'string') continue;
    for (const block of msg.content) {
      if (block.type === 'tool_use') currentRunToolUseIds.add(block.id);
    }
  }

  // 2. 生命周期：lifecycle start/end 配对 + done 事件存在
  const lifecyclePhases = events
    .filter((e) => e.type === 'agent.stream.lifecycle')
    .map((e) => (e.payload as { phase?: string }).phase);
  if (!lifecyclePhases.includes('start')) failures.push('缺少 lifecycle start 事件');
  if (!lifecyclePhases.includes('end')) failures.push('缺少 lifecycle end 事件');
  if (!events.some((e) => e.type === 'agent.stream.done')) {
    failures.push('缺少 done 事件');
  }

  // 3. 所有录制 LLM 轮次被消费（少跑迭代同样是回归）
  if (!llmProvider.consumedAllTurns) {
    failures.push(
      `录制了更多 LLM 轮次未被消费（consumed=${llmProvider.consumedTurnCount}）——当前代码提前终止了 ReAct 循环`,
    );
  }

  // 4. 无真实工具执行：本次 query 新产生的 tool_use 数与回放工具执行数一致。
  //    initialMessages 里的历史 tool_use 只是上下文，不能计入本轮执行数。
  //    （miss 会直接 throw，能走到这里说明全部命中录制结果）
  if (currentRunToolUseIds.size !== toolProvider.invocations.length) {
    failures.push(
      `本轮 tool_use 数 (${currentRunToolUseIds.size}) 与回放工具执行数 (${toolProvider.invocations.length}) 不一致`,
    );
  }

  return failures;
}

// ─── 快照 diff ──────────────────────────────────────────────────────

function diffSnapshot(
  actual: NormalizedSnapshot,
  expected: NormalizedSnapshot,
  toolInputs: unknown[],
): string[] {
  const diffs: string[] = [];

  if (actual.finalAssistantText !== expected.finalAssistantText) {
    diffs.push(
      `finalAssistantText 不一致:\n  expected: ${expected.finalAssistantText.slice(0, 200)}\n  actual:   ${actual.finalAssistantText.slice(0, 200)}`,
    );
  }

  const shapeA = actual.messagesShape.join(' | ');
  const shapeE = expected.messagesShape.join(' | ');
  if (shapeA !== shapeE) {
    diffs.push(`messagesShape 不一致:\n  expected: ${shapeE}\n  actual:   ${shapeA}`);
  }

  if (actual.toolCalls.length !== expected.toolCalls.length) {
    diffs.push(
      `toolCalls 数量不一致: expected ${expected.toolCalls.length}, actual ${actual.toolCalls.length}`,
    );
  } else {
    expected.toolCalls.forEach((exp, i) => {
      const act = actual.toolCalls[i]!;
      if (act.name !== exp.name) {
        diffs.push(`toolCalls[${i}].name: expected ${exp.name}, actual ${act.name}`);
      }
      for (const needle of exp.inputContains ?? []) {
        const inputJson = JSON.stringify(toolInputs[i]) ?? '';
        if (!inputJson.includes(needle)) {
          diffs.push(`toolCalls[${i}] input 不包含关键字: ${needle}`);
        }
      }
    });
  }

  return diffs;
}

// ─── 主入口 ─────────────────────────────────────────────────────────

const TMP_SESSION_ROOT = path.join(import.meta.dirname, '..', '.tmp-sessions');

export async function runReplayCase(
  fixtureDir: string,
  opts: { record?: boolean } = {},
): Promise<ReplayCaseResult> {
  const startedAt = Date.now();
  const fixture: ReplayFixture = loadFixture(fixtureDir);
  const record = opts.record ?? process.env.REPLAY_RECORD === '1';

  const llmProvider = new ReplayLLMProvider(fixture.turns);
  const toolProvider = new ReplayToolProvider(fixture.tools, fixture.toolResults);

  // 每次回放用独立临时 session 目录，避免 messages.jsonl 追加污染下次运行
  const sessionDir = path.join(TMP_SESSION_ROOT, `${fixture.manifest.caseId}-${Date.now()}`);
  fs.mkdirSync(sessionDir, { recursive: true });

  const runtime = createRuntime({
    provider: llmProvider,
    tools: toolProvider,
    permissionHandler: createMockPermissionHandler('allow'),
    sessionConfig: { sessionDir, threadId: `replay-${fixture.manifest.caseId}` },
    model: fixture.context.model,
    systemPrompt: fixture.context.system,
    maxTurns: fixture.turns.length + 1,
  });

  const events: StreamEvent[] = [];
  try {
    for await (const event of runtime.query({
      prompt: fixture.manifest.initialPrompt,
      initialMessages: fixture.context.initialMessages,
    })) {
      events.push(event);
    }
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }

  // ── transcript：本次 query 的 persist_message 事件（引擎实际产出）──
  const emitted = foldPersistedMessages(events);
  // 初始 messages（case 的起始状态）拼在前面，与录制 session 的完整结构对齐
  const transcript: Message[] = [...fixture.context.initialMessages, ...emitted];

  const toolInputs: unknown[] = [];
  for (const msg of transcript) {
    if (typeof msg.content === 'string') continue;
    for (const block of msg.content as ContentBlock[]) {
      if (block.type === 'tool_use') toolInputs.push(block.input);
    }
  }

  const invariantFailures = checkInvariants(transcript, emitted, events, llmProvider, toolProvider);
  const actualSnapshot = buildSnapshot(transcript);
  const warnings = [...llmProvider.warnings, ...toolProvider.warnings];

  let result: ReplayCaseResult;
  if (record) {
    const expected: ReplayExpected = {
      invariants: {
        toolUseResultPairsComplete: true,
        eventLifecycleValid: true,
        noRealToolExecution: true,
        toolInputsSchemaValid: true,
      },
      normalizedSnapshot: actualSnapshot,
    };
    writeJsonPretty(path.join(fixtureDir, 'expected.json'), expected);
    result = {
      caseId: fixture.manifest.caseId,
      passed: invariantFailures.length === 0,
      recorded: true,
      invariantFailures,
      snapshotDiffs: [],
      warnings,
      actualSnapshot,
    };
  } else {
    if (!fixture.expected) {
      throw new Error(
        `[replay] ${fixture.manifest.caseId} 缺少 expected.json —— 先用 REPLAY_RECORD=1 生成 baseline`,
      );
    }
    const snapshotDiffs = diffSnapshot(actualSnapshot, fixture.expected.normalizedSnapshot, toolInputs);
    result = {
      caseId: fixture.manifest.caseId,
      passed: invariantFailures.length === 0 && snapshotDiffs.length === 0,
      recorded: false,
      invariantFailures,
      snapshotDiffs,
      warnings,
      actualSnapshot,
    };
  }

  appendRunRecord({
    timestamp: new Date(startedAt).toISOString(),
    caseId: result.caseId,
    fixtureDir,
    mode: result.recorded ? 'record' : 'replay',
    passed: result.passed,
    durationMs: Date.now() - startedAt,
    invariantFailures: result.invariantFailures,
    snapshotDiffs: result.snapshotDiffs,
    warnings: result.warnings,
  });
  return result;
}
