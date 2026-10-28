import type { ThreadAttentionSnapshot } from '@dshfiles/thread-sidebar/attention-api'
import { describe, expect, it, vi } from 'vitest'
import { clearTabAttention } from './tab-attention.js'

const rendered: ThreadAttentionSnapshot = {
  revision: 8,
  sessions: [{ sessionId: 'a', version: 7, finishedAt: null, finishedSeq: null, finishedReason: null, manuallyUnread: true }],
}

describe('explicit tab selection attention', () => {
  it('clears only the rendered record version and refreshes after Host acceptance', async () => {
    const clearUnread = vi.fn(async () => ({ revision: 9, sessions: [] }))
    const refresh = vi.fn()
    await clearTabAttention('a', rendered, clearUnread, refresh)
    expect(clearUnread).toHaveBeenCalledExactlyOnceWith({ sessionId: 'a', version: 7 })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(clearUnread.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0] ?? 0)
    expect(rendered.sessions).toHaveLength(1)
  })

  it('does not invent a version for unread data that has not arrived or another thread', async () => {
    const clearUnread = vi.fn(async () => ({ revision: 9, sessions: [] }))
    const refresh = vi.fn()
    await clearTabAttention('a', undefined, clearUnread, refresh)
    await clearTabAttention('other', rendered, clearUnread, refresh)
    expect(clearUnread).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('leaves the displayed record intact if the Host refuses the acknowledgement', async () => {
    const clearUnread = vi.fn(async () => {
      throw new Error('Host unavailable')
    })
    const refresh = vi.fn()
    await expect(clearTabAttention('a', rendered, clearUnread, refresh)).rejects.toThrow('Host unavailable')
    expect(refresh).not.toHaveBeenCalled()
    expect(rendered.sessions[0]?.manuallyUnread).toBe(true)
  })
})
