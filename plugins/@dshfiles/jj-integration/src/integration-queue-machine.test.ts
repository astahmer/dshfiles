import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import type { IntegrationProgressRead } from './integration-queue-machine.js'
import { integrationQueueMachine } from './integration-queue-machine.js'
import type { LandResult } from './api.js'

const landed: LandResult = {
  status: 'landed',
  revisions: [{ changeId: 'change', commitId: 'commit', description: 'feat: work', conflict: false }],
  files: [],
  bookmark: 'main',
  agentAsked: false,
}

const nothingToLand: LandResult = { status: 'nothing-to-land', revisions: [], files: [], bookmark: 'main', agentAsked: false }

const conflicted: LandResult = { status: 'conflicted', revisions: [], files: ['src/a.ts'], bookmark: 'main', agentAsked: false }

const noProgress = async (): Promise<IntegrationProgressRead> => ({ progress: null })

describe('thread integration queue', () => {
  it('integrates selected work serially and advances only after each result', async () => {
    const calls: string[] = []
    const actor = createActor(integrationQueueMachine, {
      input: {
        client: {
          land: async ({ path }) => {
            calls.push(path)
            return path.endsWith('one') ? landed : nothingToLand
          },
          integrationProgress: noProgress,
        },
      },
    }).start()

    actor.send({ type: 'start', paths: ['/repo/thread-one', '/repo/thread-two'] })
    expect(actor.getSnapshot().hasTag('busy')).toBe(true)
    expect(actor.getSnapshot().context.notice).toBeNull()
    actor.send({ type: 'progress', path: '/repo/thread-one', phase: 'validating' })
    expect(actor.getSnapshot().context.jobs.get('/repo/thread-one')).toEqual({ phase: 'validating' })
    await waitFor(actor, snapshot => snapshot.matches('idle') && snapshot.context.jobs.size === 2)

    expect(calls).toEqual(['/repo/thread-one', '/repo/thread-two'])
    expect(actor.getSnapshot().context.jobs.get('/repo/thread-one')).toEqual({ phase: 'integrated' })
    expect(actor.getSnapshot().context.jobs.get('/repo/thread-two')).toEqual({ phase: 'up-to-date' })
    expect(actor.getSnapshot().context.notice).toEqual({ kind: 'land-result', result: nothingToLand })
    actor.stop()
  })

  it('continues after a failure and keeps the failed workspace retryable', async () => {
    const calls: string[] = []
    const actor = createActor(integrationQueueMachine, {
      input: {
        client: {
          land: async ({ path }) => {
            calls.push(path)
            if (path.endsWith('one')) throw new Error('thread is still active')
            return landed
          },
          integrationProgress: noProgress,
        },
      },
    }).start()

    actor.send({ type: 'start', paths: ['/repo/thread-one', '/repo/thread-two'] })
    await waitFor(actor, snapshot => snapshot.matches('idle') && snapshot.context.jobs.size === 2)

    expect(calls).toEqual(['/repo/thread-one', '/repo/thread-two'])
    expect(actor.getSnapshot().context.jobs.get('/repo/thread-one')).toEqual({ phase: 'failed', message: 'thread is still active' })
    expect(actor.getSnapshot().context.jobs.get('/repo/thread-two')).toEqual({ phase: 'integrated' })
    expect(actor.getSnapshot().context.notice).toBeNull()
    actor.stop()
  })

  it('owns the notice outcome instead of a parallel panel flag', async () => {
    const conflicts = createActor(integrationQueueMachine, {
      input: { client: { land: async () => conflicted, integrationProgress: noProgress } },
    }).start()
    conflicts.send({ type: 'start', paths: ['/repo/thread-one'] })
    await waitFor(conflicts, snapshot => snapshot.matches('idle'))
    expect(conflicts.getSnapshot().context.notice).toEqual({ kind: 'land-result', result: conflicted })
    conflicts.stop()

    const queuedError = Object.assign(new Error('Integration queued.'), { remoteCode: 'integration-queued' })
    const queued = createActor(integrationQueueMachine, {
      input: {
        client: {
          land: async () => {
            throw queuedError
          },
          integrationProgress: noProgress,
        },
      },
    }).start()
    queued.send({ type: 'start', paths: ['/repo/thread-one'] })
    await waitFor(queued, snapshot => snapshot.matches('idle'))
    expect(queued.getSnapshot().context.notice).toEqual({ kind: 'queued' })
    queued.stop()

    const failing = createActor(integrationQueueMachine, {
      input: {
        client: {
          land: async () => {
            throw new Error('thread is still active')
          },
          integrationProgress: noProgress,
        },
      },
    }).start()
    failing.send({ type: 'start', paths: ['/repo/thread-one'] })
    await waitFor(failing, snapshot => snapshot.matches('idle'))
    expect(failing.getSnapshot().context.notice).toEqual({ kind: 'failed', message: 'thread is still active' })
    failing.stop()
  })

  it('polls the Host phase while a landing runs and stops when the queue settles', async () => {
    let resolveLanding: (result: LandResult) => void = () => {}
    let progressReads = 0
    const actor = createActor(integrationQueueMachine, {
      input: {
        client: {
          land: () =>
            new Promise<LandResult>(resolve => {
              resolveLanding = resolve
            }),
          integrationProgress: async () => {
            progressReads += 1
            return { progress: { phase: 'validating' } }
          },
        },
      },
    }).start()

    actor.send({ type: 'start', paths: ['/repo/thread-one'] })
    await waitFor(actor, snapshot => snapshot.context.jobs.get('/repo/thread-one')?.phase === 'validating')
    expect(actor.getSnapshot().matches('integrating')).toBe(true)

    resolveLanding(landed)
    await waitFor(actor, snapshot => snapshot.matches('idle'))
    // oxlint-disable-next-line antislop/no-passthrough-variable -- snapshot of a counter that must not advance while the queue sits at rest.
    const readsAtRest = progressReads
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(progressReads).toBe(readsAtRest)
    actor.stop()
  })
})
