import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createActor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it, vi } from 'vitest'
import { autoArchiveMachine, type AutoArchiveClient, type AutoArchiveSettled } from './auto-archive-machine.js'

interface Deferred<Value> {
  readonly promise: Promise<Value>
  readonly resolve: (value: Value) => void
  readonly reject: (reason?: Error) => void
}

const deferred = <Value>(): Deferred<Value> => {
  let resolve = (_value: Value): void => undefined
  let reject = (_reason?: Error): void => undefined
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const sessionIds = (...values: string[]) => values.map(SessionId)

const startFlow = (client: AutoArchiveClient, intervalMs = 60_000) => {
  const actor = createActor(autoArchiveMachine, { input: { client, intervalMs } })
  const settled: AutoArchiveSettled[] = []
  actor.on('settled', event => settled.push(event))
  actor.start()
  actor.send({ type: 'configure', enabled: true, intervalMs })
  return { actor, settled }
}

describe('auto-archive machine', () => {
  it('archives sequentially, continues after failures, and emits one aggregate result', async () => {
    const started: string[] = []
    const client: AutoArchiveClient = {
      getCandidateSessionIds: () => sessionIds('first', 'fails', 'last', 'first'),
      archiveSession: async sessionId => {
        started.push(sessionId)
        if (sessionId === 'fails') throw new Error('Host unavailable')
      },
    }
    const { actor, settled } = startFlow(client)
    actor.send({ type: 'scan', source: 'regular' })

    await vi.waitFor(() => expect(settled).toHaveLength(1))

    expect(started).toEqual(['first', 'fails', 'last'])
    expect(settled).toEqual([{ type: 'settled', operationId: 1, failedSessionIds: ['fails'] }])
    actor.stop()
  })

  it('coalesces a newer candidate snapshot after the active write without overlapping Host calls', async () => {
    let candidateSessionIds = sessionIds('first', 'stale-tail')
    const firstArchive = deferred<void>()
    const started: string[] = []
    let activeCalls = 0
    let maximumActiveCalls = 0
    const client: AutoArchiveClient = {
      getCandidateSessionIds: () => candidateSessionIds,
      archiveSession: async sessionId => {
        started.push(sessionId)
        activeCalls += 1
        maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls)
        try {
          if (sessionId === 'first') await firstArchive.promise
        } finally {
          activeCalls -= 1
        }
      },
    }
    const { actor, settled } = startFlow(client)
    actor.send({ type: 'scan', source: 'regular' })
    await vi.waitFor(() => expect(started).toEqual(['first']))

    actor.send({ type: 'scan', source: 'regular' })
    candidateSessionIds = sessionIds('first', 'latest')
    actor.send({ type: 'refresh', source: 'regular' })
    actor.send({ type: 'scan', source: 'regular' })
    firstArchive.reject(new Error('Host unavailable'))

    await vi.waitFor(() => expect(started).toEqual(['first', 'latest']))
    await vi.waitFor(() => expect(settled).toHaveLength(1))

    expect(maximumActiveCalls).toBe(1)
    expect(settled).toEqual([{ type: 'settled', operationId: 2, failedSessionIds: [] }])
    actor.stop()
  })

  it('finishes an independent source scan before processing its queued candidates', async () => {
    const regularCandidates = sessionIds('regular-first', 'regular-last')
    const rebasedCandidates = sessionIds('rebased')
    const firstArchive = deferred<void>()
    const started: string[] = []
    const client: AutoArchiveClient = {
      getCandidateSessionIds: source => {
        if (source === 'regular') return regularCandidates
        if (source === 'rebased') return rebasedCandidates
        return [...regularCandidates, ...rebasedCandidates]
      },
      archiveSession: async sessionId => {
        started.push(sessionId)
        if (sessionId === 'regular-first') {
          await firstArchive.promise
          throw new Error('Host unavailable')
        }
      },
    }
    const { actor, settled } = startFlow(client)
    actor.send({ type: 'scan', source: 'regular' })
    await vi.waitFor(() => expect(started).toEqual(['regular-first']))

    actor.send({ type: 'scan', source: 'rebased' })
    firstArchive.reject(new Error('Host unavailable'))
    await vi.waitFor(() => expect(started).toEqual(['regular-first', 'regular-last', 'rebased']))
    await vi.waitFor(() => expect(settled).toHaveLength(2))

    expect(settled).toEqual([
      { type: 'settled', operationId: 1, failedSessionIds: ['regular-first'] },
      { type: 'settled', operationId: 2, failedSessionIds: [] },
    ])
    actor.stop()
  })

  it('stops the stale tail and suppresses failure notice when disabled during a write', async () => {
    const firstArchive = deferred<void>()
    const started: string[] = []
    const client: AutoArchiveClient = {
      getCandidateSessionIds: () => sessionIds('first', 'stale-tail'),
      archiveSession: async sessionId => {
        started.push(sessionId)
        if (sessionId === 'first') await firstArchive.promise
      },
    }
    const { actor, settled } = startFlow(client)
    actor.send({ type: 'scan', source: 'regular' })
    await vi.waitFor(() => expect(started).toEqual(['first']))

    actor.send({ type: 'configure', enabled: false, intervalMs: 60_000 })
    firstArchive.reject(new Error('Host unavailable'))
    await vi.waitFor(() => expect(actor.getSnapshot().matches('inactive')).toBe(true))

    expect(started).toEqual(['first'])
    expect(settled).toEqual([])
    actor.stop()
  })

  it('does not schedule more writes or emit completion after the actor stops', async () => {
    const firstArchive = deferred<void>()
    const started: string[] = []
    const client: AutoArchiveClient = {
      getCandidateSessionIds: () => sessionIds('first', 'never-started'),
      archiveSession: async sessionId => {
        started.push(sessionId)
        if (sessionId === 'first') await firstArchive.promise
      },
    }
    const { actor, settled } = startFlow(client)
    actor.send({ type: 'scan', source: 'regular' })
    await vi.waitFor(() => expect(started).toEqual(['first']))

    actor.stop()
    firstArchive.resolve()
    await Promise.resolve()

    expect(started).toEqual(['first'])
    expect(settled).toEqual([])
  })

  it('uses the actor-owned interval to retry a later failed scan', async () => {
    const started: string[] = []
    const client: AutoArchiveClient = {
      getCandidateSessionIds: () => sessionIds('retry-me'),
      archiveSession: async sessionId => {
        started.push(sessionId)
        if (started.length === 1) throw new Error('Host unavailable')
      },
    }
    const { actor, settled } = startFlow(client, 250)
    actor.send({ type: 'scan', source: 'regular' })
    await vi.waitFor(() => expect(settled).toHaveLength(1))
    await vi.waitFor(() => expect(started).toHaveLength(2))
    await vi.waitFor(() => expect(settled).toHaveLength(2))

    expect(settled[0]?.failedSessionIds).toEqual(['retry-me'])
    expect(settled[1]?.failedSessionIds).toEqual([])
    actor.stop()
  })
})
