import { describe, expect, it } from 'vitest'
import { buildReachOpenBody } from './reach-open-body'

describe('reach electron browser port · 锁膜会话归属', () => {
  it('open 把 Agent thread 传给 /open，会话 idle 才能揭锁膜', () => {
    expect(
      buildReachOpenBody(
        { url: 'https://www.xiaohongshu.com/' },
        { spaceId: 'space-1', threadId: 'bd1e06d6-243c-48cc-b890-167d92b2ff89' },
      ),
    ).toEqual(
      expect.objectContaining({
        url: 'https://www.xiaohongshu.com/',
        spaceId: 'space-1',
        _thread_id: 'bd1e06d6-243c-48cc-b890-167d92b2ff89',
        skipNavigationEvidenceCheck: true,
      }),
    )
  })
})
