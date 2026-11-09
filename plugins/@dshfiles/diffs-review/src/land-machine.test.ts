import type { LandResult, ThreadView } from '@dshfiles/jj-integration/api'
import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { landCardMachine, type LandPorts } from './land-machine.js'

const thread: ThreadView = {
  name: 'thread-abcdef',
  path: '/repo-threads/thread-abcdef',
  workspaceId: 'workspace-id',
  sessionIds: ['session-1'],
  finished: false,
  canRebase: true,
  missing: false,
  behind: false,
  behindCount: 0,
  unlanded: [{ changeId: 'change-id', commitId: 'commit-id', description: 'feat: add feature', conflict: false }],
}

const landed: LandResult = {
  status: 'landed',
  bookmark: 'main',
  revisions: thread.unlanded,
  files: ['src/index.ts'],
  agentAsked: false,
}

const deferred = <Value>() => {
  let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined
  const promise = new Promise<Value>(onResolve => {
    resolve = onResolve
  })
  return { promise, resolve }
}

const start = (ports: Partial<LandPorts> = {}) => {
  const calls: string[] = []
  const actor = createActor(landCardMachine, {
    input: {
      land: async () => {
        calls.push('land')
        return landed
      },
      queue: async () => {
        calls.push('queue')
        return { queuedAt: 1 }
      },
      unqueue: async () => {
        calls.push('unqueue')
        return { status: 'cancelled' }
      },
      refresh: () => calls.push('refresh'),
      ...ports,
    },
  })
  actor.start()
  return { actor, calls }
}

describe('land card machine', () => {
  it('confirms before landing and reports the landed result', async () => {
    const { actor, calls } = start()
    actor.send({ type: 'ask', thread })
    expect(actor.getSnapshot().matches('confirming')).toBe(true)

    actor.send({ type: 'confirm' })
    await waitFor(actor, snapshot => snapshot.matches('idle'))
    expect(calls).toEqual(['land', 'refresh'])
    expect(actor.getSnapshot().context.notice).toEqual({
      tone: 'success',
      text: 'Landed 1 revision on main.',
    })
    actor.stop()
  })

  it('cancels a confirmation without calling the Host', () => {
    const { actor, calls } = start()
    actor.send({ type: 'ask', thread })
    actor.send({ type: 'cancel' })
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(calls).toEqual([])
    actor.stop()
  })

  it('serialises the writes: queue is refused while land is in flight', async () => {
    const pending = deferred<LandResult>()
    const { actor, calls } = start({
      land: () => {
        calls.push('land')
        return pending.promise
      },
    })
    actor.send({ type: 'ask', thread })
    actor.send({ type: 'confirm' })
    expect(actor.getSnapshot().matches('landing')).toBe(true)

    actor.send({ type: 'queue', thread })
    expect(actor.getSnapshot().matches('landing')).toBe(true)

    pending.resolve(landed)
    await waitFor(actor, snapshot => snapshot.matches('idle'))
    expect(calls).toEqual(['land', 'refresh'])
    actor.stop()
  })

  it('reports a land failure and still refreshes the card', async () => {
    const { actor, calls } = start({ land: () => Promise.reject(new Error('binding moved')) })
    actor.send({ type: 'ask', thread })
    actor.send({ type: 'confirm' })
    await waitFor(actor, snapshot => snapshot.matches('idle'))
    expect(calls).toEqual(['refresh'])
    expect(actor.getSnapshot().context.notice).toEqual({ tone: 'failure', text: 'binding moved' })
    actor.stop()
  })

  it('queues from idle and reports an unqueue that lost the race', async () => {
    const { actor, calls } = start({
      unqueue: async () => {
        calls.push('unqueue')
        return { status: 'integrating' }
      },
    })
    actor.send({ type: 'queue', thread })
    await waitFor(actor, snapshot => snapshot.matches('queued'))

    actor.send({ type: 'unqueue', thread })
    await waitFor(actor, snapshot => snapshot.matches('idle'))
    expect(calls).toEqual(['queue', 'refresh', 'unqueue', 'refresh'])
    expect(actor.getSnapshot().context.notice).toEqual({ tone: 'failure', text: 'The land already started; wait for it to finish.' })
    actor.stop()
  })

  it('reports a queue failure instead of claiming the land is queued', async () => {
    const { actor } = start({ queue: () => Promise.reject(new Error('thread is busy')) })
    actor.send({ type: 'queue', thread })
    await waitFor(actor, snapshot => snapshot.matches('idle'))
    expect(actor.getSnapshot().context.notice).toEqual({
      tone: 'failure',
      text: 'thread is busy',
    })
    actor.stop()
  })

  it('clears the previous notice when the next attempt is confirmed', async () => {
    const { actor } = start({ land: () => Promise.reject(new Error('binding moved')) })
    actor.send({ type: 'ask', thread })
    actor.send({ type: 'confirm' })
    await waitFor(actor, snapshot => snapshot.matches('idle'))
    expect(actor.getSnapshot().context.notice).not.toBeNull()

    actor.send({ type: 'ask', thread })
    expect(actor.getSnapshot().context.notice).toBeNull()
    actor.stop()
  })
})
