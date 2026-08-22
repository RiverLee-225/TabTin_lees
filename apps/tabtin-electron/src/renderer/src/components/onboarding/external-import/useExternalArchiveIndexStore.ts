/**
 * 本机外部档案索引版本号——导入完成/删仓清档案后 bump，侧栏归组钩子据此重拉。
 * localOpenedByKey：首次展开时立刻把档案行换成会话行，不必等磁盘 bind。
 */

import { create } from 'zustand'

export function archiveOpenKey(source: string, sourceSessionId: string): string {
  return `${source}:${sourceSessionId}`
}

interface ExternalArchiveIndexState {
  version: number
  localOpenedByKey: Record<string, string>
  bump: () => void
  bindLocalOpened: (source: string, sourceSessionId: string, sessionId: string) => void
  unbindLocalOpened: (source: string, sourceSessionId: string) => void
}

export const useExternalArchiveIndexStore = create<ExternalArchiveIndexState>((set) => ({
  version: 0,
  localOpenedByKey: {},
  bump: () => set((s) => ({ version: s.version + 1 })),
  bindLocalOpened: (source, sourceSessionId, sessionId) => {
    const id = sessionId.trim()
    if (!id) return
    set((s) => ({
      localOpenedByKey: {
        ...s.localOpenedByKey,
        [archiveOpenKey(source, sourceSessionId)]: id,
      },
    }))
  },
  unbindLocalOpened: (source, sourceSessionId) => {
    const key = archiveOpenKey(source, sourceSessionId)
    set((s) => {
      if (!(key in s.localOpenedByKey)) return s
      const { [key]: _removed, ...rest } = s.localOpenedByKey
      return { localOpenedByKey: rest }
    })
  },
}))
