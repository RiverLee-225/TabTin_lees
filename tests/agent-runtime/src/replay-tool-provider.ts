/**
 * ReplayToolProvider——实现真实 runtime 的 ToolProvider 接口。
 *
 * 用录制时的工具 schema 生成同名 replay tools：schema 与真实工具一致
 * （模型看到的 tool 定义不变），execute() 不做任何真实动作，只按
 * toolCallId 从 tool-results.jsonl 查录制结果回灌。
 *
 * 查不到结果时抛错——这本身就是「Replay 期间没有真实工具执行」的证明。
 *
 * 全部声明 isReadOnly: true：回放工具无副作用，允许 orchestration
 * 并发执行（settle 顺序由归一化处理）。
 */

import type { Tool, ToolContext, ToolProvider, ToolResult } from './runtime-adapter.js';
import type { FixtureToolDefinition, ReplayToolResult } from './fixture-types.js';
import { stableHash } from './normalize.js';

export class ReplayToolMissError extends Error {
  constructor(toolName: string, toolCallId: string | undefined) {
    super(
      `[replay] 工具 ${toolName} 被调用（toolCallId=${toolCallId ?? '<none>'}），` +
        `但 fixture 里没有对应录制结果 —— 当前代码产生了录制之外的工具调用`,
    );
    this.name = 'ReplayToolMissError';
  }
}

export interface ReplayToolInvocation {
  toolName: string;
  toolCallId?: string;
  input: unknown;
  inputHashMatched: boolean;
}

export class ReplayToolProvider implements ToolProvider {
  /** 回放期间实际发生的工具调用记录，runner 用于断言。 */
  readonly invocations: ReplayToolInvocation[] = [];
  readonly warnings: string[] = [];

  private readonly byCallId = new Map<string, ReplayToolResult>();
  /** toolCallId 匹配失败时的兜底：按工具名 FIFO 消费。 */
  private readonly byName = new Map<string, ReplayToolResult[]>();

  constructor(
    private readonly toolDefinitions: FixtureToolDefinition[],
    recordedResults: ReplayToolResult[],
  ) {
    for (const r of recordedResults) {
      this.byCallId.set(r.toolCallId, r);
      const queue = this.byName.get(r.toolName) ?? [];
      queue.push(r);
      this.byName.set(r.toolName, queue);
    }
  }

  getTools(): Tool[] {
    return this.toolDefinitions.map((def) => this.makeReplayTool(def));
  }

  private makeReplayTool(def: FixtureToolDefinition): Tool {
    const provider = this;
    return {
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      isReadOnly: true,
      async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
        const recorded = provider.lookup(def.name, context.toolCallId);
        if (!recorded) {
          throw new ReplayToolMissError(def.name, context.toolCallId);
        }

        const inputHashMatched = stableHash(input) === recorded.inputHash;
        if (!inputHashMatched) {
          provider.warnings.push(
            `[tool ${def.name}] input 与录制值不一致 (toolCallId=${recorded.toolCallId})——` +
              `归一化 hash: 录制 ${recorded.inputHash}, 实际 ${stableHash(input)}`,
          );
        }
        provider.invocations.push({
          toolName: def.name,
          toolCallId: context.toolCallId,
          input,
          inputHashMatched,
        });

        return { content: recorded.result.content, isError: recorded.result.isError };
      },
    };
  }

  private lookup(toolName: string, toolCallId: string | undefined): ReplayToolResult | undefined {
    if (toolCallId) {
      const hit = this.byCallId.get(toolCallId);
      if (hit) {
        const queue = this.byName.get(toolName);
        if (queue) {
          const i = queue.indexOf(hit);
          if (i >= 0) queue.splice(i, 1);
        }
        this.byCallId.delete(toolCallId);
        return hit;
      }
    }
    const queue = this.byName.get(toolName);
    if (queue && queue.length > 0) {
      const hit = queue.shift()!;
      this.byCallId.delete(hit.toolCallId);
      return hit;
    }
    return undefined;
  }
}
