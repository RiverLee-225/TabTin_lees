import { describe, expect, it } from 'vitest'
import { deriveToolUseLifecycleState } from '../deriveToolUseLifecycleState'

describe('deriveToolUseLifecycleState · intent 可见阶段', () => {
  it('工具参数已封口但尚未真正开始时仍保持 calling，不误标 executing', () => {
    const state = deriveToolUseLifecycleState({
      lifecycleEvent: {
        phase: 'start',
        intent: '写入项目配置',
      },
      entryFinalized: true,
      isStreaming: true,
      isLastAssistantMsg: true,
    })

    expect(state.phase).toBe('start')
    expect(state.intent).toBe('写入项目配置')
  })

  it('终态 presentation 以 sibling tool_result 块为准，不吃 lifecycle 旧投影', () => {
    const state = deriveToolUseLifecycleState({
      lifecycleEvent: {
        phase: 'end',
        presentation: { kind: 'subagent_dispatch', data: { status: 'pending' } },
      },
      siblingToolResult: {
        content: 'done',
        presentation: { kind: 'subagent_result', data: { status: 'completed' } },
      },
      entryFinalized: true,
    })

    expect(state.presentation).toEqual({
      kind: 'subagent_result',
      data: { status: 'completed' },
    })
    expect(state.phase).toBe('end')
  })
})
