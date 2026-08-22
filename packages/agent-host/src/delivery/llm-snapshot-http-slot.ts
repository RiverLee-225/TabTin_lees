/**
 * 每会话一条 LLM 快照 HTTP 旁路槽：最新待发覆盖，同时最多一个在飞。
 * 不进 relay，不挡 persist。request 先挂起，response 或 turn 收尾再发。
 * 发出前写入账本，成功划掉；4xx 永久失败也划掉；瞬时失败当轮再试一次。
 */

import type { RelayContext } from './delivery-transport-port.js'
import type { LlmSnapshotHttpLedger } from './llm-snapshot-http-ledger.js'
import { isLlmSnapshotHttpPermanentError } from './llm-snapshot-http.js'
import { LLM_SNAPSHOT_PHASE_REQUEST } from './llm-snapshot-http-phase.js'

export {
  LLM_SNAPSHOT_PHASE_REQUEST,
  LLM_SNAPSHOT_PHASE_RESPONSE,
} from './llm-snapshot-http-phase.js'

export const LLM_SNAPSHOT_HTTP_MAX_TRANSIENT_RETRIES = 1

export type LlmSnapshotHttpUpload = (
  context: RelayContext,
  payload: Record<string, unknown>,
) => Promise<void>

export class LlmSnapshotHttpSlot {
  private pending: Record<string, unknown> | undefined
  private inFlight = false
  private consecutiveTransientFailures = 0

  constructor(
    private readonly context: RelayContext,
    private readonly upload: LlmSnapshotHttpUpload,
    private readonly ledger?: LlmSnapshotHttpLedger,
  ) {}

  /**
   * request 只占槽不发；response / 未知 phase 立即尝试发出当前槽。
   */
  holdOrSend(payload: Record<string, unknown>): void {
    this.pending = payload
    this.ledger?.remember(payload)
    if (payload.phase === LLM_SNAPSHOT_PHASE_REQUEST) return
    this.kick()
  }

  /** turn 结束或取消时，把还没发出的 request 补出去。 */
  flushPending(): void {
    this.kick()
  }

  /** 空闲或重连时，只补账本里已失败的份，不提前发出当前挂起的 request。 */
  drainLedger(): void {
    this.consecutiveTransientFailures = 0
    this.kick({ includePending: false })
  }

  private kick(options: { includePending: boolean } = { includePending: true }): void {
    if (this.inFlight) return
    const payload = this.takePayload(options.includePending)
    if (!payload) return
    this.inFlight = true
    void this.upload(this.context, payload)
      .then(() => {
        this.ledger?.ack(payload)
        this.consecutiveTransientFailures = 0
        this.inFlight = false
        this.kick(options)
      })
      .catch((error: unknown) => {
        console.warn(
          '[DeliveryCoordinator] llm snapshot HTTP upload failed session=%s err=%o',
          this.context.sessionId,
          error,
        )
        this.inFlight = false
        if (isLlmSnapshotHttpPermanentError(error)) {
          this.ledger?.ack(payload)
          this.consecutiveTransientFailures = 0
          if (options.includePending && this.pending) this.kick(options)
          return
        }
        this.consecutiveTransientFailures += 1
        if (this.consecutiveTransientFailures <= LLM_SNAPSHOT_HTTP_MAX_TRANSIENT_RETRIES) {
          this.kick(options)
          return
        }
        if (options.includePending && this.pending) this.kick(options)
      })
  }

  private takePayload(includePending: boolean): Record<string, unknown> | undefined {
    if (includePending && this.pending) {
      const payload = this.pending
      this.pending = undefined
      return payload
    }
    const payload = this.ledger?.takeNext()
    if (!payload || payload === this.pending) return undefined
    return payload
  }
}
