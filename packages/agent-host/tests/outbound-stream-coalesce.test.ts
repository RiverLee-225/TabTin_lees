import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONTENT_BLOCK_DELTA_TYPE } from '../src/delivery/relay-delta-coalesce.js'
import { OutboundStreamCoalesceBuffer } from '../src/delivery/outbound-stream-coalesce.js'

afterEach(() => {
  vi.useRealTimers()
})

function textDelta(text: string, extras: Record<string, unknown> = {}) {
  return {
    type: CONTENT_BLOCK_DELTA_TYPE,
    payload: {
      message_id: 'm-1',
      index: 0,
      delta: { type: 'text_delta', text },
      ...extras,
    },
  }
}

describe('OutboundStreamCoalesceBuffer', () => {
  it('同一 delta 的 raw 与 wrapper 副本不拼成重复字', () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const buffer = new OutboundStreamCoalesceBuffer(emit)
    const raw = textDelta('我', {
      subagent_run_id: 'child-1',
      event_id: 'e-same',
      arrival_seq: 42,
    })
    buffer.push(raw)
    buffer.push({
      type: 'agent.stream.subagent_stream_event',
      payload: {
        subagent_run_id: 'child-1',
        child_event: raw,
      },
    })
    vi.advanceTimersByTime(16)
    expect(emit).toHaveBeenCalledTimes(1)
    const emitted = emit.mock.calls[0][0]
    expect(emitted.payload.delta.text).toBe('我')
  })

  it('同一 run 内相邻同键 delta 合并后一次 emit', () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const buffer = new OutboundStreamCoalesceBuffer(emit)
    buffer.push(textDelta('hel', { subagent_run_id: 'child-1' }))
    buffer.push(textDelta('lo', { subagent_run_id: 'child-1' }))
    expect(emit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(16)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0].payload.delta).toEqual({ type: 'text_delta', text: 'hello' })
  })

  it('每个 run 一条管道，交错到达各自合并', () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const buffer = new OutboundStreamCoalesceBuffer(emit)
    buffer.push(textDelta('a', { subagent_run_id: 'child-1' }))
    buffer.push(textDelta('x', { subagent_run_id: 'child-2' }))
    buffer.push(textDelta('b', { subagent_run_id: 'child-1' }))
    buffer.push(textDelta('y', { subagent_run_id: 'child-2' }))
    expect(emit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(16)
    expect(emit).toHaveBeenCalledTimes(2)
    const texts = emit.mock.calls.map(call => call[0].payload.delta.text).sort()
    expect(texts).toEqual(['ab', 'xy'])
  })

  it('本 run 非 delta 只冲自己的管道', () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const buffer = new OutboundStreamCoalesceBuffer(emit, 16)
    buffer.push(textDelta('a', { subagent_run_id: 'child-1' }))
    buffer.push(textDelta('x', { subagent_run_id: 'child-2' }))
    buffer.push({ type: 'agent.stream.done', payload: { subagent_run_id: 'child-1' } })
    expect(emit).toHaveBeenCalledTimes(2)
    expect(emit.mock.calls[0][0].payload.delta.text).toBe('a')
    expect(emit.mock.calls[1][0].type).toBe('agent.stream.done')
    vi.advanceTimersByTime(16)
    expect(emit).toHaveBeenCalledTimes(3)
    expect(emit.mock.calls[2][0].payload.delta.text).toBe('x')
  })
})
