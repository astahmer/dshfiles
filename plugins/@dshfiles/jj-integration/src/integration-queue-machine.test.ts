import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
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
        },
      },
    }).start()

    actor.send({ type: 'start', paths: ['/repo/thread-one', '/repo/thread-two'] })
    expect(actor.getSnapshot().hasTag('busy')).toBe(true)
    actor.send({ type: 'progress', path: '/repo/thread-one', phase: 'validating' })
    expect(actor.getSnapshot().context.jobs.get('/repo/thread-one')).toEqual({ phase: 'validating' })
    await waitFor(actor, snapshot => snapshot.matches('idle') && snapshot.context.jobs.size === 2)

    expect(calls).toEqual(['/repo/thread-one', '/repo/thread-two'])
    expect(actor.getSnapshot().context.jobs.get('/repo/thread-one')).toEqual({ phase: 'integrated' })
    expect(actor.getSnapshot().context.jobs.get('/repo/thread-two')).toEqual({ phase: 'up-to-date' })
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
        },
      },
    }).start()

    actor.send({ type: 'start', paths: ['/repo/thread-one', '/repo/thread-two'] })
    await waitFor(actor, snapshot => snapshot.matches('idle') && snapshot.context.jobs.size === 2)

    expect(calls).toEqual(['/repo/thread-one', '/repo/thread-two'])
    expect(actor.getSnapshot().context.jobs.get('/repo/thread-one')).toEqual({ phase: 'failed', message: 'thread is still active' })
    expect(actor.getSnapshot().context.jobs.get('/repo/thread-two')).toEqual({ phase: 'integrated' })
    actor.stop()
  })
})
