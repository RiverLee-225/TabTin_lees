/**
 * 真实 agent-runtime 的类型 / 入口统一 re-export。
 *
 * Replay harness 里所有对 runtime 的依赖都收拢到这一个文件——
 * runtime 目录结构变化时只改这里。
 */

export { createRuntime } from '../../../packages/agent-runtime/src/engine/query.js';

export type {
  ContentBlock,
  EngineConfig,
  LLMProvider,
  LLMRequest,
  LLMResponseChunk,
  Message,
  StreamEvent,
  SystemBlock,
  Tool,
  ToolContext,
  ToolProvider,
  ToolResult,
  ToolUseBlock,
} from '../../../packages/agent-runtime/src/engine/types.js';

export {
  createMockPermissionHandler,
} from '../../../packages/agent-runtime/tests/test-utils.js';
