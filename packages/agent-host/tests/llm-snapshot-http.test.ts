import { describe, expect, it, vi } from 'vitest'
import {
  HTTP_STATUS_TOO_MANY_REQUESTS,
  LLM_SNAPSHOT_HTTP_DEFAULT_RETRY_AFTER_MS,
  LlmSnapshotHttpError,
  buildLlmSnapshotHttpBody,
  buildLlmSnapshotHttpPath,
  isLlmSnapshotHttpPermanentError,
  parseRetryAfterMs,
  postLlmSnapshotHttp,
} from '../src/delivery/llm-snapshot-http.js'

describe('llm-snapshot-http', () => {
  it('builds the session-scoped path and body', () => {
    expect(buildLlmSnapshotHttpPath('sess/1')).toBe(
      '/chat/sessions/sess%2F1/llm-snapshots',
    )
    expect(buildLlmSnapshotHttpBody({ runId: 'run-1' })).toEqual({
      snapshot: { runId: 'run-1' },
    })
  })

  it('posts the capped snapshot and throws on HTTP errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    await postLlmSnapshotHttp({
      apiBaseUrl: 'https://api.test.local/api',
      sessionId: 'session-1',
      organizationId: 'org-1',
      accessToken: 'tok',
      payload: { runId: 'run-1', phase: 'request' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      joinApiPath: (base, path) => `${base}${path}`,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.test.local/api/chat/sessions/session-1/llm-snapshots')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'X-Organization-Id': 'org-1',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      snapshot: { runId: 'run-1', phase: 'request' },
    })

    fetchImpl.mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers() })
    const failure = await postLlmSnapshotHttp({
      apiBaseUrl: 'https://api.test.local/api',
      sessionId: 'session-1',
      accessToken: 'tok',
      payload: { runId: 'run-1' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      joinApiPath: (base, path) => `${base}${path}`,
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(LlmSnapshotHttpError)
    expect(isLlmSnapshotHttpPermanentError(failure)).toBe(true)
  })

  it('parses Retry-After and retries a rate-limited post', async () => {
    expect(parseRetryAfterMs({
      headers: new Headers({ 'Retry-After': '3' }),
    })).toBe(3_000)
    expect(parseRetryAfterMs({ headers: new Headers() })).toBe(
      LLM_SNAPSHOT_HTTP_DEFAULT_RETRY_AFTER_MS,
    )

    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: HTTP_STATUS_TOO_MANY_REQUESTS,
        headers: new Headers({ 'Retry-After': '1' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() })
    const sleepImpl = vi.fn().mockResolvedValue(undefined)

    await postLlmSnapshotHttp({
      apiBaseUrl: 'https://api.test.local/api',
      sessionId: 'session-1',
      accessToken: 'tok',
      payload: { runId: 'run-1' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      joinApiPath: (base, path) => `${base}${path}`,
      sleepImpl,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleepImpl).toHaveBeenCalledWith(1_000)
  })
})
