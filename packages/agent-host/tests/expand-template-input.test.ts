/**
 * ：模板展开的 tool_domains 三态语义回归。
 *
 * 主 Agent 传入的 tool_domains 一律忽略。
 * 模板无约束 → 动态继承父工具；有 allow/deny → 以父工具快照过滤。
 */
import { describe, expect, it } from 'vitest'
import { expandTemplateIntoAgentInput } from '../src/configuration/expand-template-input.js'
import type {
  SubAgentTemplateSnapshot,
  TemplateSnapshotsGetter,
} from '../src/configuration/subagent-template-resolver.js'

const PARENT_TOOLS = ['read_file', 'grep_search', 'run_terminal_command', 'skills_read']

function snapshotsWith(overrides: Partial<SubAgentTemplateSnapshot>): TemplateSnapshotsGetter {
  const snapshot: SubAgentTemplateSnapshot = {
    id: 'tpl-1',
    name: '调研模板',
    description: '',
    systemPrompt: '',
    subagentType: 'explore',
    allowedTools: [],
    deniedTools: [],
    modelId: '',
    thinkingLevel: '',
    defaultMode: 'wait',
    version: 1,
    isEnabled: true,
    ...overrides,
  }
  return async () => new Map([[snapshot.id, snapshot]])
}

async function expand(input: Record<string, unknown>, snapshots: TemplateSnapshotsGetter) {
  return expandTemplateIntoAgentInput(input, snapshots, PARENT_TOOLS)
}

describe('expandTemplateIntoAgentInput tool_domains 三态', () => {
  it('无模板约束 + 未传 → 不物化白名单（保持动态继承）', async () => {
    const { input } = await expand(
      { prompt: 'x', template_id: 'tpl-1' },
      snapshotsWith({}),
    )
    expect('tool_domains' in input).toBe(false)
  })

  it('无模板约束 + 主 Agent 传入空数组 → 忽略，保持动态继承', async () => {
    const { input } = await expand(
      { prompt: 'x', template_id: 'tpl-1', tool_domains: [] },
      snapshotsWith({}),
    )
    expect('tool_domains' in input).toBe(false)
  })

  it('无模板约束 + 主 Agent 传入子集 → 忽略，保持动态继承', async () => {
    const { input } = await expand(
      { prompt: 'x', template_id: 'tpl-1', tool_domains: ['read_file'] },
      snapshotsWith({}),
    )
    expect('tool_domains' in input).toBe(false)
  })

  it('模板 allow 约束 + 未传 → 以父工具快照为基础过滤', async () => {
    const { input } = await expand(
      { prompt: 'x', template_id: 'tpl-1' },
      snapshotsWith({ allowedTools: ['read_file', 'grep_search'] }),
    )
    expect(input.tool_domains).toEqual(['read_file', 'grep_search'])
  })

  it('模板 allow 约束 + 主 Agent 传入子集 → 忽略调用方，只按模板 allow', async () => {
    const { input } = await expand(
      { prompt: 'x', template_id: 'tpl-1', tool_domains: ['read_file', 'skills_read'] },
      snapshotsWith({ allowedTools: ['read_file', 'grep_search'] }),
    )
    expect(input.tool_domains).toEqual(['read_file', 'grep_search'])
  })

  it('模板 deny 约束 + 未传 → 从父工具快照中排除 denied', async () => {
    const { input } = await expand(
      { prompt: 'x', template_id: 'tpl-1' },
      snapshotsWith({ deniedTools: ['run_terminal_command'] }),
    )
    expect(input.tool_domains).toEqual(['read_file', 'grep_search', 'skills_read'])
  })

  it('模板 deny 约束 + 主 Agent 传入被 deny 的名字 → 忽略调用方，仍按父快照排除 deny', async () => {
    const { input } = await expand(
      { prompt: 'x', template_id: 'tpl-1', tool_domains: ['run_terminal_command'] },
      snapshotsWith({ deniedTools: ['run_terminal_command'] }),
    )
    expect(input.tool_domains).toEqual(['read_file', 'grep_search', 'skills_read'])
  })

  it('模板 allow/deny 约束 + 主 Agent 传入空数组 → 忽略调用方，按模板过滤父快照', async () => {
    const { input } = await expand(
      { prompt: 'x', template_id: 'tpl-1', tool_domains: [] },
      snapshotsWith({ allowedTools: ['read_file'], deniedTools: ['run_terminal_command'] }),
    )
    expect(input.tool_domains).toEqual(['read_file'])
  })

  it('模板未命中 → 剥离 template_id 与调用方 tool_domains', async () => {
    const { input } = await expandTemplateIntoAgentInput(
      { prompt: 'x', template_id: 'missing', tool_domains: [] },
      async () => new Map(),
      PARENT_TOOLS,
    )
    expect(input).toEqual({ prompt: 'x' })
  })

  it('无 template_id → 剥离调用方 tool_domains', async () => {
    const { input } = await expandTemplateIntoAgentInput(
      { prompt: 'x', tool_domains: ['app:tabcode/tabcode-operator'] },
      async () => new Map(),
      PARENT_TOOLS,
    )
    expect(input).toEqual({ prompt: 'x' })
  })
})
