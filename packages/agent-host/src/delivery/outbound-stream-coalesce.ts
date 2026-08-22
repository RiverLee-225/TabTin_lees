/**
 * 出站统一合并：IPC 与 WS 在分叉前共用这一次结果。
 *
 * 每个 run（主 Agent / 子 Agent）一条管道，管道内只拼相邻同键 delta。
 * 交错到达不进同一条管道，也不用全局分槽表硬拼。
 * 覆盖裸 delta，以及 `subagent_stream_event` 包装里的 child_event。
 * 非 delta 只冲本 run 的管道，再立刻下发。
 */

import {
  CONTENT_BLOCK_DELTA_TYPE,
  relayDeltaCoalesceKey,
  tryAppendCoalescedDelta,
  type RelayBatchEvent,
} from './relay-delta-coalesce.js'

export const OUTBOUND_STREAM_COALESCE_FLUSH_MS = 16

const SUBAGENT_STREAM_EVENT = 'agent.stream.subagent_stream_event'
const MAIN_RUN_KEY = ''

export type OutboundStreamEvent = {
  type: string
  payload: Record<string, unknown>
}

export function outboundCoalesceRunKey(event: OutboundStreamEvent): string {
  const payload = event.payload
  if (typeof payload.subagent_run_id === 'string' && payload.subagent_run_id.length > 0) {
    return payload.subagent_run_id
  }
  if (typeof payload.run_id === 'string' && payload.run_id.length > 0) {
    return payload.run_id
  }
  return MAIN_RUN_KEY
}

function cloneDeltaEvent(event: OutboundStreamEvent): OutboundStreamEvent {
  const payload: Record<string, unknown> = { ...event.payload }
  const child = payload.child_event
  if (child && typeof child === 'object' && !Array.isArray(child)) {
    const wrapped = child as { type?: unknown; payload?: unknown }
    const childPayload = wrapped.payload
    payload.child_event = {
      ...wrapped,
      payload: childPayload && typeof childPayload === 'object' && !Array.isArray(childPayload)
        ? { ...childPayload as Record<string, unknown> }
        : childPayload,
    }
  }
  const delta = payload.delta
  if (delta && typeof delta === 'object' && !Array.isArray(delta)) {
    payload.delta = { ...delta as Record<string, unknown> }
  }
  return { type: event.type, payload }
}

function asCoalesceTarget(event: OutboundStreamEvent): RelayBatchEvent | null {
  if (event.type === CONTENT_BLOCK_DELTA_TYPE) {
    return { type: event.type, payload: event.payload }
  }
  if (event.type !== SUBAGENT_STREAM_EVENT) return null
  const child = event.payload.child_event
  if (!child || typeof child !== 'object' || Array.isArray(child)) return null
  const wrapped = child as { type?: unknown; payload?: unknown }
  if (wrapped.type !== CONTENT_BLOCK_DELTA_TYPE) return null
  if (!wrapped.payload || typeof wrapped.payload !== 'object' || Array.isArray(wrapped.payload)) {
    return null
  }
  const payload: Record<string, unknown> = { ...wrapped.payload as Record<string, unknown> }
  if (typeof event.payload.subagent_run_id === 'string' && !payload.subagent_run_id) {
    payload.subagent_run_id = event.payload.subagent_run_id
  }
  return { type: CONTENT_BLOCK_DELTA_TYPE, payload }
}

function writeCoalesced(original: OutboundStreamEvent, merged: RelayBatchEvent): OutboundStreamEvent {
  if (original.type === CONTENT_BLOCK_DELTA_TYPE) {
    return { type: original.type, payload: merged.payload }
  }
  const child = original.payload.child_event
  const prev = child && typeof child === 'object' && !Array.isArray(child)
    ? child as Record<string, unknown>
    : {}
  return {
    type: original.type,
    payload: {
      ...original.payload,
      child_event: {
        ...prev,
        type: CONTENT_BLOCK_DELTA_TYPE,
        payload: merged.payload,
      },
    },
  }
}

/** 单 run 管道：只合并相邻同键 delta。 */
class OutboundStreamCoalescePipe {
  private pending: OutboundStreamEvent | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly emit: (event: OutboundStreamEvent) => void,
    private readonly flushMs: number,
  ) {}

  push(event: OutboundStreamEvent): void {
    const incoming = asCoalesceTarget(event)
    if (this.pending && incoming) {
      const target = asCoalesceTarget(this.pending)
      if (target) {
        const result = tryAppendCoalescedDelta(target, incoming)
        if (result === 'merged') {
          this.pending = writeCoalesced(this.pending, target)
          this.ensureTimer()
          return
        }
      }
    }

    this.flush()
    if (incoming && relayDeltaCoalesceKey(incoming.payload)) {
      this.pending = cloneDeltaEvent(event)
      this.ensureTimer()
      return
    }
    this.emit(event)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const pending = this.pending
    this.pending = null
    if (pending) this.emit(pending)
  }

  dispose(): void {
    this.flush()
  }

  private ensureTimer(): void {
    if (this.timer != null) return
    if (this.flushMs <= 0) {
      this.flush()
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.flushMs)
  }
}

/** 按 run 分管道，再各自做出站合并。 */
export class OutboundStreamCoalesceBuffer {
  private readonly pipes = new Map<string, OutboundStreamCoalescePipe>()

  constructor(
    private readonly emit: (event: OutboundStreamEvent) => void,
    private readonly flushMs: number = OUTBOUND_STREAM_COALESCE_FLUSH_MS,
  ) {}

  push(event: OutboundStreamEvent): void {
    const key = outboundCoalesceRunKey(event)
    let pipe = this.pipes.get(key)
    if (!pipe) {
      pipe = new OutboundStreamCoalescePipe(this.emit, this.flushMs)
      this.pipes.set(key, pipe)
    }
    pipe.push(event)
  }

  flush(): void {
    for (const pipe of this.pipes.values()) pipe.flush()
  }

  dispose(): void {
    this.flush()
    this.pipes.clear()
  }
}
