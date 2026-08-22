/**
 * LLM 快照 HTTP 旁路账本：发出前记账，成功划掉，失败留着下次再送。
 * 不进 relay outbox。每会话最多保留最近若干把钥匙。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  LLM_SNAPSHOT_PHASE_REQUEST,
  LLM_SNAPSHOT_PHASE_RESPONSE,
} from './llm-snapshot-http-phase.js'

export const LLM_SNAPSHOT_LEDGER_MAX_KEYS = 32
export const LLM_SNAPSHOT_LEDGER_DIR_NAME = 'llm-snapshot-ledgers'
export const LLM_SNAPSHOT_LEDGER_FILE_EXTENSION = '.json'
export const LLM_SNAPSHOT_LEDGER_FILE_MODE = 0o600

export type LlmSnapshotLedgerRecord = {
  key: string
  payload: Record<string, unknown>
  rememberedAt: number
}

export type LlmSnapshotLedgerFile = {
  sessionId: string
  organizationId: string
  records: LlmSnapshotLedgerRecord[]
}

export type LlmSnapshotLedgerPendingSession = {
  sessionId: string
  organizationId: string
}

export interface LlmSnapshotLedgerStore {
  loadFile(): LlmSnapshotLedgerFile | null
  saveFile(file: LlmSnapshotLedgerFile): void
}

export interface LlmSnapshotLedgerDirectory {
  storeFor(sessionId: string): LlmSnapshotLedgerStore
  listPending(): LlmSnapshotLedgerPendingSession[]
}

export type LlmSnapshotLedgerIdentity = {
  sessionId: string
  organizationId: string
}

export function llmSnapshotLedgerKey(
  payload: Record<string, unknown>,
): string | undefined {
  const runId = payload.runId ?? payload.run_id
  if (typeof runId !== 'string' || runId.length === 0) return undefined
  const iteration = typeof payload.iteration === 'number' ? payload.iteration : 0
  return `${runId}:${iteration}`
}

export function shouldReplaceLlmSnapshotLedgerPayload(
  current: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): boolean {
  if (!current) return true
  if (incoming.phase === LLM_SNAPSHOT_PHASE_RESPONSE) return true
  if (
    current.phase === LLM_SNAPSHOT_PHASE_RESPONSE
    && incoming.phase === LLM_SNAPSHOT_PHASE_REQUEST
  ) {
    return false
  }
  return true
}

export function llmSnapshotLedgerFileName(sessionId: string): string {
  return `${encodeURIComponent(sessionId)}${LLM_SNAPSHOT_LEDGER_FILE_EXTENSION}`
}

export function resolveLlmSnapshotLedgerDir(dataRoot: string): string {
  return path.join(dataRoot, LLM_SNAPSHOT_LEDGER_DIR_NAME)
}

function isLedgerRecord(value: unknown): value is LlmSnapshotLedgerRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.key === 'string'
    && record.payload !== null
    && typeof record.payload === 'object'
    && !Array.isArray(record.payload)
    && typeof record.rememberedAt === 'number'
}

export class LlmSnapshotHttpLedger {
  private readonly records = new Map<string, LlmSnapshotLedgerRecord>()
  private hydrated = false
  private persistQueued = false

  constructor(
    private readonly identity: LlmSnapshotLedgerIdentity,
    private readonly store?: LlmSnapshotLedgerStore,
    private readonly maxKeys: number = LLM_SNAPSHOT_LEDGER_MAX_KEYS,
    private readonly now: () => number = Date.now,
  ) {}

  remember(payload: Record<string, unknown>): void {
    this.hydrate()
    const key = llmSnapshotLedgerKey(payload)
    if (!key) return
    const current = this.records.get(key)
    if (!shouldReplaceLlmSnapshotLedgerPayload(current?.payload, payload)) {
      return
    }
    this.records.set(key, {
      key,
      payload,
      rememberedAt: this.now(),
    })
    this.trim()
    this.schedulePersist()
  }

  ack(payload: Record<string, unknown>): void {
    this.hydrate()
    const key = llmSnapshotLedgerKey(payload)
    if (!key) return
    const current = this.records.get(key)
    if (!current || current.payload !== payload) return
    this.records.delete(key)
    this.schedulePersist()
  }

  /** 测试与关停前把挂起的落盘做完。 */
  flushSync(): void {
    this.persistQueued = false
    this.persist()
  }

  takeNext(): Record<string, unknown> | undefined {
    this.hydrate()
    let oldest: LlmSnapshotLedgerRecord | undefined
    for (const record of this.records.values()) {
      if (!oldest || record.rememberedAt < oldest.rememberedAt) {
        oldest = record
      }
    }
    return oldest?.payload
  }

  private hydrate(): void {
    if (this.hydrated) return
    this.hydrated = true
    if (!this.store) return
    try {
      const file = this.store.loadFile()
      if (!file) return
      for (const record of file.records) {
        if (isLedgerRecord(record)) {
          this.records.set(record.key, record)
        }
      }
    } catch (error: unknown) {
      console.warn(
        '[DeliveryCoordinator] llm snapshot ledger load failed session=%s err=%o',
        this.identity.sessionId,
        error,
      )
    }
  }

  private trim(): void {
    while (this.records.size > this.maxKeys) {
      let oldest: LlmSnapshotLedgerRecord | undefined
      for (const record of this.records.values()) {
        if (!oldest || record.rememberedAt < oldest.rememberedAt) {
          oldest = record
        }
      }
      if (!oldest) return
      this.records.delete(oldest.key)
    }
  }

  private schedulePersist(): void {
    if (this.persistQueued) return
    this.persistQueued = true
    queueMicrotask(() => {
      this.persistQueued = false
      this.persist()
    })
  }

  private persist(): void {
    if (!this.store) return
    try {
      this.store.saveFile({
        sessionId: this.identity.sessionId,
        organizationId: this.identity.organizationId,
        records: [...this.records.values()],
      })
    } catch (error: unknown) {
      console.warn(
        '[DeliveryCoordinator] llm snapshot ledger save failed session=%s err=%o',
        this.identity.sessionId,
        error,
      )
    }
  }
}

export class FileLlmSnapshotLedgerStore implements LlmSnapshotLedgerStore {
  constructor(private readonly filePath: string) {}

  loadFile(): LlmSnapshotLedgerFile | null {
    if (!fs.existsSync(this.filePath)) return null
    const raw = fs.readFileSync(this.filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const file = parsed as Record<string, unknown>
    if (typeof file.sessionId !== 'string' || typeof file.organizationId !== 'string') {
      return null
    }
    if (!Array.isArray(file.records)) return null
    return {
      sessionId: file.sessionId,
      organizationId: file.organizationId,
      records: file.records.filter(isLedgerRecord),
    }
  }

  saveFile(file: LlmSnapshotLedgerFile): void {
    if (file.records.length === 0) {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath)
      }
      return
    }
    const dir = path.dirname(this.filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    const tmpPath = `${this.filePath}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(file), {
      encoding: 'utf8',
      mode: LLM_SNAPSHOT_LEDGER_FILE_MODE,
    })
    fs.renameSync(tmpPath, this.filePath)
  }
}

export class FileLlmSnapshotLedgerDirectory implements LlmSnapshotLedgerDirectory {
  constructor(private readonly rootDir: string) {}

  storeFor(sessionId: string): LlmSnapshotLedgerStore {
    return new FileLlmSnapshotLedgerStore(
      path.join(this.rootDir, llmSnapshotLedgerFileName(sessionId)),
    )
  }

  listPending(): LlmSnapshotLedgerPendingSession[] {
    if (!fs.existsSync(this.rootDir)) return []
    const pending: LlmSnapshotLedgerPendingSession[] = []
    for (const name of fs.readdirSync(this.rootDir)) {
      if (!name.endsWith(LLM_SNAPSHOT_LEDGER_FILE_EXTENSION)) continue
      if (name.endsWith('.tmp')) continue
      const store = new FileLlmSnapshotLedgerStore(path.join(this.rootDir, name))
      try {
        const file = store.loadFile()
        if (!file || file.records.length === 0) continue
        pending.push({
          sessionId: file.sessionId,
          organizationId: file.organizationId,
        })
      } catch (error: unknown) {
        console.warn(
          '[DeliveryCoordinator] llm snapshot ledger list skipped file=%s err=%o',
          name,
          error,
        )
      }
    }
    return pending
  }
}
