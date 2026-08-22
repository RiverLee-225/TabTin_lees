/**
 * LLM 快照 HTTP 旁路——不进 relay_events，避免整段上下文复印件堵住 persist。
 */

export const LLM_SNAPSHOT_HTTP_TIMEOUT_MS = 20_000
export const HTTP_STATUS_TOO_MANY_REQUESTS = 429
export const HTTP_STATUS_BAD_REQUEST = 400
export const HTTP_STATUS_CLIENT_ERROR_END = 500
export const LLM_SNAPSHOT_HTTP_MAX_RATE_LIMIT_RETRIES = 2
export const LLM_SNAPSHOT_HTTP_DEFAULT_RETRY_AFTER_MS = 1_000
export const LLM_SNAPSHOT_HTTP_MAX_RETRY_AFTER_MS = 15_000
export const LLM_SNAPSHOT_HTTP_PATH_SUFFIX = '/llm-snapshots'

export class LlmSnapshotHttpError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`llm snapshot HTTP ${status}`)
    this.name = 'LlmSnapshotHttpError'
    this.status = status
  }

  get permanent(): boolean {
    return (
      this.status >= HTTP_STATUS_BAD_REQUEST
      && this.status < HTTP_STATUS_CLIENT_ERROR_END
      && this.status !== HTTP_STATUS_TOO_MANY_REQUESTS
    )
  }
}

export function isLlmSnapshotHttpPermanentError(error: unknown): boolean {
  return error instanceof LlmSnapshotHttpError && error.permanent
}

export function buildLlmSnapshotHttpPath(sessionId: string): string {
  return `/chat/sessions/${encodeURIComponent(sessionId)}${LLM_SNAPSHOT_HTTP_PATH_SUFFIX}`
}

export function buildLlmSnapshotHttpBody(
  payload: Record<string, unknown>,
): { snapshot: Record<string, unknown> } {
  return { snapshot: payload }
}

export function parseRetryAfterMs(response: {
  headers: { get(name: string): string | null }
}): number {
  const header = response.headers.get('Retry-After')
  const seconds = header == null ? Number.NaN : Number(header)
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, LLM_SNAPSHOT_HTTP_MAX_RETRY_AFTER_MS)
  }
  return LLM_SNAPSHOT_HTTP_DEFAULT_RETRY_AFTER_MS
}

export async function postLlmSnapshotHttp(input: {
  apiBaseUrl: string
  sessionId: string
  organizationId?: string
  accessToken: string
  payload: Record<string, unknown>
  fetchImpl?: typeof fetch
  joinApiPath: (base: string, path: string) => string
  sleepImpl?: (ms: number) => Promise<void>
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch
  const sleepImpl = input.sleepImpl ?? ((ms) => new Promise((resolve) => {
    setTimeout(resolve, ms)
  }))
  const url = input.joinApiPath(input.apiBaseUrl, buildLlmSnapshotHttpPath(input.sessionId))
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${input.accessToken}`,
    'X-Client-Type': 'electron',
    ...(input.organizationId ? { 'X-Organization-Id': input.organizationId } : {}),
  }
  const body = JSON.stringify(buildLlmSnapshotHttpBody(input.payload))

  let attempt = 0
  while (true) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(LLM_SNAPSHOT_HTTP_TIMEOUT_MS),
    })
    if (response.ok) return
    const canRetry =
      response.status === HTTP_STATUS_TOO_MANY_REQUESTS
      && attempt < LLM_SNAPSHOT_HTTP_MAX_RATE_LIMIT_RETRIES
    if (!canRetry) {
      throw new LlmSnapshotHttpError(response.status)
    }
    attempt += 1
    await sleepImpl(parseRetryAfterMs(response))
  }
}
