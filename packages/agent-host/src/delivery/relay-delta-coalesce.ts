/**
 * ：relay 出站路径合并连续同键 `content_block_delta`。
 *
 * 出站统一合并（IPC / WS 分叉前）与 DeliveryBatchBuffer 队尾折叠共用同一套规则。
 *
 * 防窜消息硬约束：
 * - 合并键 = `subagent_run_id?` + `message_id` + `index` + `delta.type`（缺 message/index/type 则不合并）
 * - 只合并**相邻**且同键的可拼接 delta
 * - 不同 message / 不同 block index / 不同 delta 类型 / start·stop 插入 → 绝不合并
 * - `citations_delta` 等结构化增量不合并
 * - 拼接后单字段超限则切开（返回 overflow，由调用方另起一条）
 */

export const CONTENT_BLOCK_DELTA_TYPE = 'agent.stream.content_block_delta'

/** 单条合并后字符串字段上限，避免单帧过大拖垮 ACK。 */
export const RELAY_DELTA_COALESCE_MAX_CHARS = 48 * 1024

const COALESCEABLE_DELTA_TYPES = new Set([
  'text_delta',
  'thinking_delta',
  'input_json_delta',
  'signature_delta',
  'connector_text_delta',
])

const DELTA_STRING_FIELD: Record<string, string> = {
  text_delta: 'text',
  thinking_delta: 'thinking',
  input_json_delta: 'partial_json',
  signature_delta: 'signature',
  connector_text_delta: 'connector_text',
}

export type RelayBatchEvent = {
  type: string
  payload: Record<string, unknown>
}

/**
 * 返回稳定合并键；不可合并时返回 null。
 * 键内用 `\0` 分隔，避免 message_id / type 文本碰撞。
 */
export function relayDeltaCoalesceKey(payload: Record<string, unknown>): string | null {
  const messageId = payload.message_id
  const index = payload.index
  const delta = payload.delta
  if (typeof messageId !== 'string' || messageId.length === 0) return null
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return null
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) return null
  const deltaType = (delta as { type?: unknown }).type
  if (typeof deltaType !== 'string' || !COALESCEABLE_DELTA_TYPES.has(deltaType)) return null
  const runId = typeof payload.subagent_run_id === 'string' ? payload.subagent_run_id : ''
  return `${runId}\0${messageId}\0${index}\0${deltaType}`
}

function cloneRelayEvent(event: RelayBatchEvent): RelayBatchEvent {
  const payload: Record<string, unknown> = { ...event.payload }
  const delta = payload.delta
  if (delta && typeof delta === 'object' && !Array.isArray(delta)) {
    payload.delta = { ...(delta as Record<string, unknown>) }
  }
  return { type: event.type, payload }
}

/**
 * 尝试把 `incoming` 拼进 `target`（同键可拼接 delta）。
 * - merged：已写入 target（替换 payload 引用，不改动 incoming / 原 IPC 对象）
 * - overflow：同键但超限，调用方应另起一条
 * - incompatible：键不同或类型不可拼
 */
function isDuplicateDeltaIdentity(
  target: Record<string, unknown>,
  incoming: Record<string, unknown>,
): boolean {
  const targetEventId = target.event_id
  const incomingEventId = incoming.event_id
  if (
    typeof targetEventId === 'string'
    && targetEventId.length > 0
    && targetEventId === incomingEventId
  ) {
    return true
  }
  const targetSeq = target.arrival_seq
  const incomingSeq = incoming.arrival_seq
  return typeof targetSeq === 'number'
    && Number.isFinite(targetSeq)
    && targetSeq === incomingSeq
}

export function tryAppendCoalescedDelta(
  target: RelayBatchEvent,
  incoming: RelayBatchEvent,
  maxChars: number = RELAY_DELTA_COALESCE_MAX_CHARS,
): 'merged' | 'overflow' | 'incompatible' {
  if (
    target.type !== CONTENT_BLOCK_DELTA_TYPE
    || incoming.type !== CONTENT_BLOCK_DELTA_TYPE
  ) {
    return 'incompatible'
  }

  const targetKey = relayDeltaCoalesceKey(target.payload)
  const incomingKey = relayDeltaCoalesceKey(incoming.payload)
  if (!targetKey || !incomingKey || targetKey !== incomingKey) {
    return 'incompatible'
  }

  const targetDelta = target.payload.delta as Record<string, unknown>
  const incomingDelta = incoming.payload.delta as Record<string, unknown>
  const field = DELTA_STRING_FIELD[String(targetDelta.type)]
  if (!field) return 'incompatible'

  // 子 Agent 同一条 delta 会走 trace + 父投影两条投递；同 event_id / arrival_seq
  // 只是副本，不能再拼正文，否则 UI 变成「我我先先」。
  if (isDuplicateDeltaIdentity(target.payload, incoming.payload)) {
    return 'merged'
  }

  const prev = typeof targetDelta[field] === 'string' ? (targetDelta[field] as string) : ''
  const next = typeof incomingDelta[field] === 'string' ? (incomingDelta[field] as string) : ''
  if (prev.length + next.length > maxChars) {
    return 'overflow'
  }

  const prevCount = Number.isSafeInteger(target.payload.coalesced_count)
    && (target.payload.coalesced_count as number) > 0
    ? target.payload.coalesced_count
    : 1
  const incomingCount = Number.isSafeInteger(incoming.payload.coalesced_count)
    && (incoming.payload.coalesced_count as number) > 0
    ? incoming.payload.coalesced_count
    : 1

  // 身份字段取最新一条（event_id / arrival_seq 等）；正文为累积拼接。
  target.payload = {
    ...incoming.payload,
    delta: {
      ...incomingDelta,
      [field]: prev + next,
    },
    coalesced_count: (prevCount as number) + (incomingCount as number),
  }
  return 'merged'
}

/** 对一批 relay 事件做相邻同键合并（保序，不跨非 delta / 不同键）。 */
export function coalesceRelayBatch(
  events: readonly RelayBatchEvent[],
  maxChars: number = RELAY_DELTA_COALESCE_MAX_CHARS,
): RelayBatchEvent[] {
  if (events.length <= 1) {
    return events.map(cloneRelayEvent)
  }

  const out: RelayBatchEvent[] = []
  for (const event of events) {
    if (out.length === 0) {
      out.push(cloneRelayEvent(event))
      continue
    }
    const last = out[out.length - 1]!
    const result = tryAppendCoalescedDelta(last, event, maxChars)
    if (result === 'merged') continue
    out.push(cloneRelayEvent(event))
  }
  return out
}
