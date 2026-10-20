import { describe, expect, it } from 'vitest'
import type { LandResult } from './api.js'
import { createDeferredIntegrations, type DeferredIntegrationSettlement } from './deferred-integrations.js'

const landed: LandResult = { status: 'landed', revisions: [], files: [], bookmark: 'main', agentAsked: false }

class Busy extends Error {}

const harness = (land: Parameters<typeof createDeferredIntegrations>[0]['land']) => {
  const settled: { readonly path: string; readonly settlement: DeferredIntegrationSettlement }[] = []
  const queue = createDeferredIntegrations({
    land,
    isWaitingError: error => error instanceof Busy,
    onSettled: (entry, settlement) => settled.push({ path: entry.path, settlement }),
    now: () => 42,
  })
  return { queue, settled }
}

describe('deferred integrations', () => {
  it('records only actual queue and cancel transitions, scoped by workspace', () => {
    const { queue } = harness(async () => landed)
    queue.queue({ path: '/repo/a', sessionId: undefined })
    queue.queue({ path: '/repo/a', sessionId: undefined })
    queue.queue({ path: '/repo/b', sessionId: undefined })
    expect(queue.cancel('/repo/a')).toBe('cancelled')
    expect(queue.cancel('/repo/a')).toBe('not-queued')
    expect(queue.history('/repo/a')).toEqual([
      { at: 42, kind: 'queued' },
      { at: 42, kind: 'unqueued' },
    ])
    expect(queue.history('/repo/b')).toEqual([{ at: 42, kind: 'queued' }])
    queue.clear()
    expect(queue.history('/repo/a')).toEqual([])
  })

  it('bounds retained queue history', () => {
    const { queue } = harness(async () => landed)
    for (let index = 0; index < 501; index += 1) {
      queue.queue({ path: '/repo/a', sessionId: undefined })
      queue.cancel('/repo/a')
    }
    expect(queue.history('/repo/a')).toHaveLength(1_000)
  })

  it('keeps a busy thread queued and integrates it once the guard passes', async () => {
    let busy = true
    const { queue, settled } = harness(async ({ stillQueued }) => {
      if (busy) throw new Busy()
      if (!stillQueued()) throw new Error('cancelled')
      return landed
    })
    queue.queue({ path: '/repo/thread-a', sessionId: 's1' })

    await queue.drain()
    expect(queue.get('/repo/thread-a')?.queuedAt).toBe(42)
    expect(settled).toEqual([])

    busy = false
    await queue.drain()
    expect(queue.get('/repo/thread-a')).toBeUndefined()
    expect(settled).toEqual([{ path: '/repo/thread-a', settlement: { kind: 'result', result: landed } }])
  })

  it('drops a cancelled request without settling it, even when the guard is mid-flight', async () => {
    let releaseGuard: () => void = () => undefined
    const guard = new Promise<void>(resolve => {
      releaseGuard = resolve
    })
    const { queue, settled } = harness(async ({ stillQueued }) => {
      await guard
      if (!stillQueued()) throw new Error('cancelled')
      return landed
    })
    queue.queue({ path: '/repo/thread-a', sessionId: undefined })

    const draining = queue.drain()
    expect(queue.cancel('/repo/thread-a')).toBe('cancelled')
    releaseGuard()
    await draining

    expect(settled).toEqual([])
    expect(queue.cancel('/repo/thread-a')).toBe('not-queued')
  })

  it('refuses to cancel once the rebase started', async () => {
    let releaseRebase: () => void = () => undefined
    const rebase = new Promise<void>(resolve => {
      releaseRebase = resolve
    })
    let rebasing: () => void = () => undefined
    const started = new Promise<void>(resolve => {
      rebasing = resolve
    })
    const { queue, settled } = harness(async ({ stillQueued }) => {
      if (!stillQueued()) throw new Error('cancelled')
      rebasing()
      await rebase
      return landed
    })
    queue.queue({ path: '/repo/thread-a', sessionId: undefined })

    const draining = queue.drain()
    await started
    expect(queue.cancel('/repo/thread-a')).toBe('integrating')
    expect(queue.history('/repo/thread-a')).toEqual([{ at: 42, kind: 'queued' }])
    releaseRebase()
    await draining

    expect(settled.map(entry => entry.settlement.kind)).toEqual(['result'])
  })

  it('settles an error that is not about waiting so the request does not retry forever', async () => {
    const failure = new Error('not a thread')
    const { queue, settled } = harness(async () => {
      throw failure
    })
    queue.queue({ path: '/repo/thread-a', sessionId: undefined })

    await queue.drain()

    expect(queue.get('/repo/thread-a')).toBeUndefined()
    expect(settled).toEqual([{ path: '/repo/thread-a', settlement: { kind: 'error', error: failure } }])
  })
})
