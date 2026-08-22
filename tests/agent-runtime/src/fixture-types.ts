/**
 * Replay Case fixture schema。
 *
 * 目录约定：
 *   fixtures/<case-name>/
 *     manifest.json       case 身份 + 人工验收信息
 *     context.json        引擎启动上下文（system prompt + 初始 messages）
 *     tools.json          录制时的完整工具 schema 列表（inputSchema 为 camelCase，
 *                         与 snapshots.jsonl 落盘格式一致）
 *     llm-turns.jsonl     每轮 requestSummary + responseChunks
 *     tool-results.jsonl  每次工具调用的录制结果
 *     expected.json       不变量 + 归一化快照基线
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { LLMResponseChunk, Message } from './runtime-adapter.js';

// ─── manifest.json ──────────────────────────────────────────────────

export interface ReplayManifest {
  caseId: string;
  title: string;
  module: string;
  priority: string;
  initialPrompt: string;
  preconditions: string[];
  sourceSessionId: string;
  sourceSessionDir?: string;
  sourceCommit?: string | null;
  acceptedAt: string;
  acceptedBy?: string | null;
  acceptanceSummary?: string;
  /** 该 case 对应的真实 session runId；单 session 多轮对话拆 case 时用于追踪来源。 */
  sourceRunId?: string;
  /** 该 run 在 session 主链路中的 1-based 顺序。 */
  sourceRunIndex?: number;
}

// ─── tools.json ─────────────────────────────────────────────────────

/** fixture 里的工具定义（与 snapshots.jsonl 的 tools 字段同构）。 */
export interface FixtureToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ─── llm-turns.jsonl ────────────────────────────────────────────────

export interface SystemSectionSummary {
  name: string;
  charCount: number;
}

/**
 * 请求侧摘要——ReplayLLMProvider 用它做输入漂移检测。
 * hash 均为归一化后内容的 sha256 前 16 位（见 normalize.ts stableHash）。
 */
export interface RequestSummary {
  model: string;
  maxTokens?: number;
  systemCharCount: number;
  systemSections: SystemSectionSummary[];
  messageCount: number;
  /** `${role}:${source}:${format}`，轻量结构断言。 */
  messageShape: string[];
  toolCount: number;
  toolNames: string[];
  toolsHash: string;
  messagesHash: string;
}

export interface ReplayLLMTurn {
  iteration: number;
  requestSource: string;
  requestSummary: RequestSummary;
  responseChunks: LLMResponseChunk[];
}

// ─── tool-results.jsonl ─────────────────────────────────────────────

export interface ReplayToolResult {
  toolCallId: string;
  toolName: string;
  /** 归一化后 input 的 stableHash，回放时弱校验（不一致仅告警）。 */
  inputHash: string;
  result: {
    content: string;
    isError?: boolean;
  };
}

// ─── context.json ───────────────────────────────────────────────────

export interface ReplayContext {
  system: string;
  initialMessages: Message[];
  model: string;
  maxTokens?: number;
  requestSource: string;
}

// ─── expected.json ──────────────────────────────────────────────────

export interface ExpectedInvariants {
  toolUseResultPairsComplete: boolean;
  eventLifecycleValid: boolean;
  noRealToolExecution: boolean;
  toolInputsSchemaValid: boolean;
}

export interface ExpectedToolCall {
  name: string;
  /** 人工可选补充：input 序列化后必须包含的关键字。 */
  inputContains?: string[];
}

export interface NormalizedSnapshot {
  finalAssistantText: string;
  /** 如 "user:user_input" / "assistant:tool_use" / "user:tool_result" / "assistant:history" */
  messagesShape: string[];
  toolCalls: ExpectedToolCall[];
}

export interface ReplayExpected {
  invariants: ExpectedInvariants;
  normalizedSnapshot: NormalizedSnapshot;
}

// ─── fixture 读写 ───────────────────────────────────────────────────

export interface ReplayFixture {
  dir: string;
  manifest: ReplayManifest;
  context: ReplayContext;
  tools: FixtureToolDefinition[];
  turns: ReplayLLMTurn[];
  toolResults: ReplayToolResult[];
  /** record 模式下首次导出时可能还没有 expected.json。 */
  expected: ReplayExpected | null;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function readJsonl<T>(file: string): T[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
}

export function loadFixture(dir: string): ReplayFixture {
  const expectedFile = path.join(dir, 'expected.json');
  return {
    dir,
    manifest: readJson<ReplayManifest>(path.join(dir, 'manifest.json')),
    context: readJson<ReplayContext>(path.join(dir, 'context.json')),
    tools: readJson<FixtureToolDefinition[]>(path.join(dir, 'tools.json')),
    turns: readJsonl<ReplayLLMTurn>(path.join(dir, 'llm-turns.jsonl')),
    toolResults: readJsonl<ReplayToolResult>(path.join(dir, 'tool-results.jsonl')),
    expected: fs.existsSync(expectedFile) ? readJson<ReplayExpected>(expectedFile) : null,
  };
}

export function writeJsonPretty(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function writeJsonl(file: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

export function discoverFixtureDirs(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(rootDir, e.name))
    .filter((d) => fs.existsSync(path.join(d, 'manifest.json')))
    .sort();
}
