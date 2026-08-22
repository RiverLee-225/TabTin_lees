/**
 * 已展开导入的删除目标：磁盘索引、打开登记、内存 bind 任一命中即可。
 */

import type { ExternalArchiveDeleteTarget } from '@components/chat/session/ExternalArchiveDeleteDialog'
import {
  markExternalOpenedContinuation,
  resolveExternalOpenedSession,
} from './externalOpenedSessionRegistry'
import { useExternalArchiveIndexStore } from './useExternalArchiveIndexStore'
import {
  hasTabtinContinuationMessages,
  type ExternalArchiveMessageLike,
} from './mergeExternalArchiveMessages'

export function resolveOpenedExternalArchiveTarget(
  sessionId: string,
  fromList?: (id: string) => ExternalArchiveDeleteTarget | null,
): ExternalArchiveDeleteTarget | null {
  const id = sessionId.trim()
  if (!id) return null

  const listed = fromList?.(id)
  if (listed) return listed

  const remembered = resolveExternalOpenedSession(id)
  if (remembered) {
    return {
      source: remembered.source,
      sourceSessionId: remembered.sourceSessionId,
      title: remembered.title,
      openedSessionId: remembered.openedSessionId,
    }
  }

  const localOpenedByKey = useExternalArchiveIndexStore.getState().localOpenedByKey
  for (const [key, openedId] of Object.entries(localOpenedByKey)) {
    if (openedId !== id) continue
    const sep = key.indexOf(':')
    if (sep <= 0) continue
    const source = key.slice(0, sep)
    const sourceSessionId = key.slice(sep + 1)
    if (!source || !sourceSessionId) continue
    return {
      source,
      sourceSessionId,
      title: sourceSessionId,
      openedSessionId: id,
    }
  }
  return null
}

/** 仅在本机已灌入消息、且能确认没有 TabTin 续聊时删除导入。消息未加载则不当未续聊。 */
export function shouldDeleteOpenedExternalArchiveSession(
  sessionId: string,
  isExternalOpened: boolean,
  messages: readonly ExternalArchiveMessageLike[] | null | undefined,
): boolean {
  if (!isExternalOpened) return false
  if (resolveExternalOpenedSession(sessionId)?.hasTabtinContinuation) return false
  if (!messages?.length) return false
  if (hasTabtinContinuationMessages(messages)) {
    markExternalOpenedContinuation(sessionId)
    return false
  }
  return true
}
