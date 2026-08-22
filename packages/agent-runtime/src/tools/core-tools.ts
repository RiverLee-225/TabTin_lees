import type {
  StreamEvent,
} from '../engine/contracts/wire-protocol.js';
import type {
  Tool,
  ToolContext,
  ToolResult,
} from '../engine/contracts/tools.js';
import { TodoEvent } from '../event/events/proposal-events.js'
import { jsonError } from '../capability/core/_utils.js'
import { createAskTools } from './ask-tools.js'
import {
  deriveOpenTodoList,
  type TodoSessionAnchor,
} from '../todo/todo-replay.js'
import { applyTodoAction } from '../todo/todo-state-machine.js'
import type { SkillCredentialResolver, SkillCredentialInjection } from './skill-credential-types.js'
export type { SkillCredentialResolver, SkillCredentialInjection }

// ─── Schemas ─────────────────────────────────────────────────────────

const openTodoItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1, description: '唯一标识符。' },
    content: { type: 'string', minLength: 1, description: 'todo 描述。' },
    status: {
      type: 'string',
      enum: ['pending', 'in_progress', 'completed', 'cancelled'],
    },
  },
  required: ['id', 'content', 'status'],
} as const

// action 判别：open 必带 items；其余字段按 action 在 execute 校验（弱模型对 oneOf 支持差）。
const todoInputSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['open', 'add', 'update', 'remove', 'close'],
      description:
        'open=建新列表（只在此时传 items）；add=只传 item；update=只传 id，以及 content 和/或 status（禁止 items/item）；remove=只传 id；close=不传其它字段。',
    },
    items: {
      type: 'array',
      description: '仅 action=open：初始完整列表（至少 1 项）。update/add/remove/close 禁止传 items，传入也会被忽略。',
      items: openTodoItemSchema,
      minItems: 1,
    },
    item: {
      type: 'object',
      description: '仅 action=add：新增一项。open/update/remove/close 禁止传 item。',
      properties: {
        id: { type: 'string', minLength: 1 },
        content: { type: 'string', minLength: 1 },
        status: { type: 'string', enum: ['pending', 'in_progress'] },
      },
      required: ['id', 'content'],
    },
    id: { type: 'string', description: 'update / remove 必填：只改/删这一条。' },
    content: { type: 'string', description: 'update 可选：只改这一条的文案。' },
    status: {
      type: 'string',
      enum: ['pending', 'in_progress', 'paused', 'completed', 'cancelled'],
      description:
        'update 可选：只改这一条的状态。同时最多一条 in_progress：必须先把当前 in_progress 标 completed/paused，再另一次 update 把下一项标 in_progress。',
    },
  },
  required: ['action'],
} as unknown as Tool['inputSchema']

// ─── Factory ─────────────────────────────────────────────────────────

export interface CoreToolsDeps {
  emitStreamEvent?: (event: StreamEvent) => void
  /**
   *  / ：与 `buildTodoStateHook` 共用的会话锚。
   * 窗口内 todo 事件被截断后，execute 仍能以锚为种子做 update/close。
   */
  todoSessionAnchor?: TodoSessionAnchor
}

export function createCoreTools(deps: CoreToolsDeps): Tool[] {
  return [
    ...createAskTools(deps),
    createTodoTool(deps),
  ]
}

// ─── todo（ 生命周期 CRUD）─────────────────────────────────────

function createTodoTool(deps: CoreToolsDeps): Tool {
  return {
    name: 'todo',
    policyActionKind: 'object_write',
    // ：Agent 自身任务状态（进度看板），不碰用户资产——judge 对
    // riskLevel='safe' 的 object_write 直接放行，不弹审批。
    riskLevel: 'safe',
    description:
      '管理当前任务的 todo 列表。action=open/add/update/remove/close。' +
      'open 带 items[] 建表；update 每次只改一条（id + content/status），不要传 items 或 item；' +
      '同时最多一条 in_progress，须先结束当前项再开下一项。' +
      '参数：action；items；id；content；status。',
    inputSchema: todoInputSchema,
    isReadOnly: false,
    execute: async (input: unknown, context: ToolContext): Promise<ToolResult> => {
      // ：execute 前当前 tool_use 已在 messages；回放须排除自身，
      // 否则第一次 open 会被当成 already_open。失败 result 由 derive 侧跳过。
      // ：seed = 会话锚（仅窗口内已无 todo 事件时生效，见 derive）。
      const seed = deps.todoSessionAnchor?.current ?? undefined
      const current = deriveOpenTodoList(context.messages ?? [], seed, {
        excludeToolUseIds: context.toolUseId ? [context.toolUseId] : undefined,
      })
      const result = applyTodoAction(current, input)

      if (!result.ok) {
        return jsonError(result.message, {
          error_kind: result.error_kind,
          field: result.field,
          hint: result.hint,
        })
      }

      if (deps.todoSessionAnchor) {
        deps.todoSessionAnchor.current = result.snapshot.map((t) => ({
          id: t.id,
          content: t.content,
          status: t.status,
        }))
      }

      const emitter = context.emitStreamEvent ?? deps.emitStreamEvent
      if (emitter) {
        emitter(
          new TodoEvent({
            action: result.action,
            todos: result.snapshot,
            closed: result.closed,
          }).toStreamEvent(),
        )
      }

      const hasPausedItem = result.snapshot.some((t) => t.status === 'paused')
      const nextStepNote = result.closed
        ? ' List is now closed. Open a new list with action=open before planning the next task.'
        : hasPausedItem
          ? ' End the current turn without closing the list. Resume the paused item with status=in_progress when the blocking condition is resolved; pending follow-up items remain open for then.'
          : ' Continue with the current in_progress item if any.'

      return {
        content:
          `Todo ${result.action} succeeded (${result.snapshot.length} item(s), closed=${result.closed}).` +
          nextStepNote,
      }
    },
  }
}
