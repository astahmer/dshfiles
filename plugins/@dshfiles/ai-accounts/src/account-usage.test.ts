import { describe, expect, it } from 'vitest'
import type { UsageCard } from './api.js'
import { boundedUsageRead } from './account-usage.js'

const okCard: UsageCard = {
  status: 'ok',
  message: null,
  identity: null,
  plan: null,
  windows: [{ label: 'Current session', percentRemaining: 42, resetsAt: null }],
  bankedResets: 0,
  bankedResetExpiries: [],
}

describe('bounded usage read', () => {
  it('times out a held provider read on its own card while the other accounts keep their answers', async () => {
    let heldSignal: AbortSignal | undefined
    const held = boundedUsageRead({
      read: signal => {
        heldSignal = signal
        return new Promise<UsageCard>(() => undefined)
      },
      timeoutMs: 20,
    })
    const answered = boundedUsageRead({ read: async () => okCard, timeoutMs: 20 })

    const [slow, fast] = await Promise.all([held, answered])

    expect(fast).toEqual(okCard)
    expect(slow.status).toBe('error')
    expect(slow.message).toMatch(/did not answer within 1 s\. Refresh to try again/u)
    expect(heldSignal?.aborted).toBe(true)
  })

  it('aborts the provider read when the whole sweep is cancelled', async () => {
    const sweep = new AbortController()
    let readSignal: AbortSignal | undefined
    void boundedUsageRead({
      read: signal => {
        readSignal = signal
        return new Promise<UsageCard>(() => undefined)
      },
      timeoutMs: 60_000,
      signal: sweep.signal,
    })
    sweep.abort()
    expect(readSignal?.aborted).toBe(true)
  })
})
