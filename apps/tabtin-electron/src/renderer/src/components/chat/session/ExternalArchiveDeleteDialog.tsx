export type ExternalArchiveDeleteTarget = {
  source: string
  sourceSessionId: string
  title: string
  openedSessionId?: string | null
}

export function externalArchiveConfirmId(target: Pick<
  ExternalArchiveDeleteTarget,
  'source' | 'sourceSessionId' | 'openedSessionId'
>): string {
  const opened = target.openedSessionId?.trim()
  if (opened) return opened
  return `${target.source}:${target.sourceSessionId}`
}
