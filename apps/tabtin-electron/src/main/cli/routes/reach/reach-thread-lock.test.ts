import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

describe('reach route · 锁膜会话归属', () => {
  it('把 CLI 注入的 _thread_id 传给 browser port，避免 Agent 停掉后锁膜成孤儿', () => {
    const source = fs.readFileSync(path.resolve(currentDir, '../reach.ts'), 'utf8')

    expect(source).toMatch(
      /createElectronBrowserPort\([\s\S]*?_thread_id/,
    )
  })
})
