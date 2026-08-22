import { afterEach, describe, expect, it } from 'vitest'
import {
  rememberExternalOpenedSession,
  syncExternalOpenedSessions,
} from '../externalOpenedSessionRegistry'
import {
  resolveOpenedExternalArchiveTarget,
  shouldDeleteOpenedExternalArchiveSession,
} from '../resolveOpenedExternalArchive'
import { useExternalArchiveIndexStore } from '../useExternalArchiveIndexStore'

afterEach(() => {
  syncExternalOpenedSessions([])
  useExternalArchiveIndexStore.setState({ localOpenedByKey: {}, version: 0 })
})

describe('resolveOpenedExternalArchiveTarget', () => {
  it('prefers the list resolver, then registry, then local bind', () => {
    expect(resolveOpenedExternalArchiveTarget('chat-1', () => ({
      source: 'cursor',
      sourceSessionId: 'src-1',
      title: 'list',
      openedSessionId: 'chat-1',
    }))).toMatchObject({ title: 'list' })

    rememberExternalOpenedSession('chat-2', {
      source: 'cursor',
      sourceSessionId: 'src-2',
      title: 'remembered',
    })
    expect(resolveOpenedExternalArchiveTarget('chat-2')).toMatchObject({ title: 'remembered' })

    useExternalArchiveIndexStore.getState().bindLocalOpened('cursor', 'src-3', 'chat-3')
    expect(resolveOpenedExternalArchiveTarget('chat-3')).toMatchObject({
      source: 'cursor',
      sourceSessionId: 'src-3',
      openedSessionId: 'chat-3',
    })
  })
})

describe('shouldDeleteOpenedExternalArchiveSession', () => {
  const imported = [{
    id: 'ext-a1',
    role: 'assistant' as const,
    content: '外来',
    metadata: { external_archive: true },
  }]

  it('requires loaded imported messages and no live turn', () => {
    expect(shouldDeleteOpenedExternalArchiveSession('s1', true, [])).toBe(false)
    expect(shouldDeleteOpenedExternalArchiveSession('s1', true, imported)).toBe(true)
    expect(shouldDeleteOpenedExternalArchiveSession('s1', true, [
      ...imported,
      { id: 'live-1', role: 'user', content: '接着做' },
    ])).toBe(false)
  })
})
