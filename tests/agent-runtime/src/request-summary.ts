/**
 * 请求侧摘要与漂移检测。
 *
 * ReplayLLMProvider 对 Runtime 生成的真实 LLMRequest 计算 summary，
 * 与 fixture 录制值比对；漂移时抛出**分类错误**，让失败一眼可归因：
 *   - prompt assembly changed   （system prompt 组装变了）
 *   - tool schema changed       （工具名单 / schema 变了）
 *   - message history changed   （消息历史结构 / 内容变了）
 *
 * 适配真实 runtime 的请求形状：
 *   - system: string | SystemBlock[]（flatten 后再抽段落）
 *   - tools:  ToolParam[]（input_schema snake_case → 归一到 fixture 的 inputSchema）
 */

import type { LLMRequest, Message, SystemBlock } from './runtime-adapter.js';
import type { RequestSummary, SystemSectionSummary } from './fixture-types.js';
import { stableHash } from './normalize.js';

export type DriftKind =
  | 'prompt assembly changed'
  | 'tool schema changed'
  | 'message history changed';

export class RequestDriftError extends Error {
  constructor(
    readonly kind: DriftKind,
    readonly iteration: number,
    readonly details: string[],
  ) {
    super(
      `[replay drift] ${kind} @ iteration ${iteration}\n` +
        details.map((d) => `  - ${d}`).join('\n'),
    );
    this.name = 'RequestDriftError';
  }
}

export function flattenSystem(system: string | SystemBlock[] | undefined): string {
  if (!system) return '';
  if (typeof system === 'string') return system;
  return system.map((b) => b.text).join('\n');
}

/** 从 `<section>...</section>` 风格的 system prompt 里抽段落摘要。 */
export function extractSystemSections(system: string): SystemSectionSummary[] {
  const sections: SystemSectionSummary[] = [];
  const re = /<([a-z_][a-z0-9_-]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(system)) !== null) {
    sections.push({ name: match[1]!, charCount: match[2]!.length });
  }
  if (sections.length === 0) {
    sections.push({ name: 'base_prompt', charCount: system.length });
  }
  return sections;
}

function messageFormat(msg: Message): 'text' | 'blocks' {
  return typeof msg.content === 'string' ? 'text' : 'blocks';
}

/** 粗分类消息来源，与 fixture 的 messageShape 对齐。 */
export function classifyMessage(msg: Message): string {
  if (typeof msg.content !== 'string') {
    const types = msg.content.map((b) => b.type);
    if (types.includes('tool_result')) return 'tool_result';
    if (types.includes('tool_use')) return 'tool_use';
  }
  return msg.role === 'user' ? 'user_input' : 'history';
}

/** 真实请求的 ToolParam（input_schema）归一到 fixture 形状（inputSchema）再 hash。 */
function normalizeToolParams(
  tools: LLMRequest['tools'],
): Array<{ name: string; description: string; inputSchema: unknown }> {
  return (tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: (t as { input_schema?: unknown }).input_schema ??
      (t as { inputSchema?: unknown }).inputSchema,
  }));
}

export function buildRequestSummaryFromParts(parts: {
  model: string;
  maxTokens?: number;
  system: string;
  messages: Message[];
  tools: Array<{ name: string; description: string; inputSchema: unknown }>;
}): RequestSummary {
  return {
    model: parts.model,
    maxTokens: parts.maxTokens,
    systemCharCount: parts.system.length,
    systemSections: extractSystemSections(parts.system),
    messageCount: parts.messages.length,
    messageShape: parts.messages.map(
      (m) => `${m.role}:${classifyMessage(m)}:${messageFormat(m)}`,
    ),
    toolCount: parts.tools.length,
    toolNames: parts.tools.map((t) => t.name).sort(),
    toolsHash: stableHash(parts.tools),
    messagesHash: stableHash(parts.messages),
  };
}

export function buildRequestSummary(request: LLMRequest): RequestSummary {
  return buildRequestSummaryFromParts({
    model: request.model,
    maxTokens: request.maxTokens,
    system: flattenSystem(request.system),
    messages: request.messages,
    tools: normalizeToolParams(request.tools),
  });
}

export interface DriftCheckOptions {
  /**
   * strict=false（默认）：hash 不一致只产生 warning（环境段落每次必变，
   * 首版先跑稳结构断言）；strict=true：hash 不一致视为硬漂移。
   */
  strictHash?: boolean;
}

export interface DriftCheckResult {
  warnings: string[];
}

export function assertNoDrift(
  actual: RequestSummary,
  recorded: RequestSummary,
  iteration: number,
  options: DriftCheckOptions = {},
): DriftCheckResult {
  const warnings: string[] = [];

  // ── system prompt 组装 ──
  const promptIssues: string[] = [];
  const actualSections = actual.systemSections.map((s) => s.name).join(',');
  const recordedSections = recorded.systemSections.map((s) => s.name).join(',');
  if (actualSections !== recordedSections) {
    promptIssues.push(`system sections: recorded [${recordedSections}] vs actual [${actualSections}]`);
  }
  // 字符数允许 20% 浮动（环境段落长度天然抖动）
  const charDrift = Math.abs(actual.systemCharCount - recorded.systemCharCount);
  if (charDrift > recorded.systemCharCount * 0.2) {
    promptIssues.push(
      `systemCharCount: recorded ${recorded.systemCharCount} vs actual ${actual.systemCharCount}`,
    );
  }
  if (promptIssues.length > 0) {
    throw new RequestDriftError('prompt assembly changed', iteration, promptIssues);
  }

  // ── tool schema ──
  const toolIssues: string[] = [];
  if (actual.toolCount !== recorded.toolCount) {
    toolIssues.push(`toolCount: recorded ${recorded.toolCount} vs actual ${actual.toolCount}`);
  }
  const missing = recorded.toolNames.filter((n) => !actual.toolNames.includes(n));
  const added = actual.toolNames.filter((n) => !recorded.toolNames.includes(n));
  if (missing.length > 0) toolIssues.push(`missing tools: ${missing.join(', ')}`);
  if (added.length > 0) toolIssues.push(`added tools: ${added.join(', ')}`);
  if (toolIssues.length > 0) {
    throw new RequestDriftError('tool schema changed', iteration, toolIssues);
  }
  if (actual.toolsHash !== recorded.toolsHash) {
    const msg = `toolsHash drift: recorded ${recorded.toolsHash} vs actual ${actual.toolsHash} (schema 内容变化)`;
    if (options.strictHash) throw new RequestDriftError('tool schema changed', iteration, [msg]);
    warnings.push(msg);
  }

  // ── message history ──
  const msgIssues: string[] = [];
  if (actual.messageCount !== recorded.messageCount) {
    msgIssues.push(`messageCount: recorded ${recorded.messageCount} vs actual ${actual.messageCount}`);
  }
  const shapeA = actual.messageShape.join(' | ');
  const shapeR = recorded.messageShape.join(' | ');
  if (shapeA !== shapeR) {
    msgIssues.push(`messageShape:\n      recorded: ${shapeR}\n      actual:   ${shapeA}`);
  }
  if (msgIssues.length > 0) {
    throw new RequestDriftError('message history changed', iteration, msgIssues);
  }
  if (actual.messagesHash !== recorded.messagesHash) {
    const msg = `messagesHash drift: recorded ${recorded.messagesHash} vs actual ${actual.messagesHash}`;
    if (options.strictHash) {
      throw new RequestDriftError('message history changed', iteration, [msg]);
    }
    warnings.push(msg);
  }

  return { warnings };
}
