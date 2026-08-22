import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FileLlmSnapshotLedgerDirectory,
  FileLlmSnapshotLedgerStore,
  LLM_SNAPSHOT_LEDGER_MAX_KEYS,
  LlmSnapshotHttpLedger,
  llmSnapshotLedgerFileName,
  llmSnapshotLedgerKey,
  resolveLlmSnapshotLedgerDir,
  shouldReplaceLlmSnapshotLedgerPayload,
} from '../src/delivery/llm-snapshot-http-ledger.js'
import {
  LLM_SNAPSHOT_PHASE_REQUEST,
  LLM_SNAPSHOT_PHASE_RESPONSE,
} from '../src/delivery/llm-snapshot-http-phase.js'

const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-snapshot-ledger-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('llm-snapshot-http-ledger', () => {
  it('keys a snapshot by run and iteration', () => {
    expect(llmSnapshotLedgerKey({ runId: 'run-1', iteration: 2 })).toBe('run-1:2')
    expect(llmSnapshotLedgerKey({ run_id: 'run-1' })).toBe('run-1:0')
    expect(llmSnapshotLedgerKey({ iteration: 1 })).toBeUndefined()
  })

  it('keeps a response instead of an older request for the same key', () => {
    const response = { phase: LLM_SNAPSHOT_PHASE_RESPONSE }
    expect(shouldReplaceLlmSnapshotLedgerPayload(undefined, { phase: LLM_SNAPSHOT_PHASE_REQUEST })).toBe(true)
    expect(shouldReplaceLlmSnapshotLedgerPayload(
      { phase: LLM_SNAPSHOT_PHASE_REQUEST },
      response,
    )).toBe(true)
    expect(shouldReplaceLlmSnapshotLedgerPayload(
      response,
      { phase: LLM_SNAPSHOT_PHASE_REQUEST },
    )).toBe(false)
  })

  it('acks only the payload that was actually uploaded', () => {
    const ledger = new LlmSnapshotHttpLedger({
      sessionId: 'session-1',
      organizationId: 'org-1',
    })
    const request = { runId: 'run-1', iteration: 0, phase: LLM_SNAPSHOT_PHASE_REQUEST }
    const response = { runId: 'run-1', iteration: 0, phase: LLM_SNAPSHOT_PHASE_RESPONSE }
    ledger.remember(request)
    ledger.remember(response)
    ledger.ack(request)
    expect(ledger.takeNext()).toBe(response)
    ledger.ack(response)
    expect(ledger.takeNext()).toBeUndefined()
  })

  it('drops the oldest keys when the cap is exceeded', () => {
    let now = 1
    const ledger = new LlmSnapshotHttpLedger(
      { sessionId: 'session-1', organizationId: 'org-1' },
      undefined,
      LLM_SNAPSHOT_LEDGER_MAX_KEYS,
      () => now++,
    )
    for (let index = 0; index < LLM_SNAPSHOT_LEDGER_MAX_KEYS + 1; index += 1) {
      ledger.remember({
        runId: `run-${index}`,
        iteration: 0,
        phase: LLM_SNAPSHOT_PHASE_RESPONSE,
      })
    }
    expect(llmSnapshotLedgerKey(ledger.takeNext() ?? {})).toBe('run-1:0')
  })

  it('writes a per-session file and forgets it after the last ack', () => {
    const dir = makeTmpDir()
    const store = new FileLlmSnapshotLedgerStore(
      path.join(dir, llmSnapshotLedgerFileName('session-1')),
    )
    const ledger = new LlmSnapshotHttpLedger(
      { sessionId: 'session-1', organizationId: 'org-1' },
      store,
    )
    const payload = { runId: 'run-1', iteration: 0, phase: LLM_SNAPSHOT_PHASE_RESPONSE }
    ledger.remember(payload)
    ledger.flushSync()
    const file = store.loadFile()
    expect(file?.sessionId).toBe('session-1')
    expect(file?.organizationId).toBe('org-1')
    expect(file?.records).toHaveLength(1)
    ledger.ack(payload)
    ledger.flushSync()
    expect(store.loadFile()).toBeNull()
  })

  it('lists pending sessions from the ledger directory', () => {
    const root = resolveLlmSnapshotLedgerDir(makeTmpDir())
    const directory = new FileLlmSnapshotLedgerDirectory(root)
    const ledger = new LlmSnapshotHttpLedger(
      { sessionId: 'session-2', organizationId: 'org-2' },
      directory.storeFor('session-2'),
    )
    ledger.remember({
      runId: 'run-9',
      iteration: 1,
      phase: LLM_SNAPSHOT_PHASE_REQUEST,
    })
    ledger.flushSync()
    expect(directory.listPending()).toEqual([
      { sessionId: 'session-2', organizationId: 'org-2' },
    ])
  })
})
