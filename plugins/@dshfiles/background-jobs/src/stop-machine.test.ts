import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { backgroundJobStopMachine, type StopMachineInput } from './stop-machine.js'
import type { JobKill } from './types.js'

const killed: JobKill = { jobId: 'job-1', outcome: 'requested' }

const deferred = <Value>() => {
  let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined
  let reject: (error?: unknown) => void = () => undefined
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const start = (input: Partial<StopMachineInput> = {}) => {
  const refreshes: number[] = []
  const actor = createActor(backgroundJobStopMachine, {
    input: {
      kill: () => Promise.resolve(killed),
      refresh: () => refreshes.push(refreshes.length),
      ...input,
    },
  })
  actor.start()
  return { actor, refreshes }
}

const select = (actor: ReturnType<typeof start>['actor'], ids: readonly string[]) => {
  actor.send({ type: 'visible', ids })
  actor.send({ type: 'select.all', orderedIds: ids })
}

describe('background job stop machine', () => {
  it('arms one row, stops it and clears the outcome once the Host answers', async () => {
    const pending = deferred<JobKill>()
    const { actor, refreshes } = start({ kill: () => pending.promise })
    select(actor, ['job-1'])

    actor.send({ type: 'arm', id: 'job-1' })
    expect(actor.getSnapshot().matches('armed')).toBe(true)
    expect(actor.getSnapshot().context.armedId).toBe('job-1')

    actor.send({ type: 'stop' })
    expect(actor.getSnapshot().matches({ stopping: 'single' })).toBe(true)
    expect(actor.getSnapshot().context.targetIds).toEqual(['job-1'])

    pending.resolve(killed)
    await waitFor(actor, snapshot => snapshot.matches('idle'))
    expect(actor.getSnapshot().context.armedId).toBeNull()
    expect(actor.getSnapshot().context.failure).toBeNull()
    expect(refreshes).toHaveLength(1)
    actor.stop()
  })

  it('keeps the row armed and reports the error when a single stop fails', async () => {
    const { actor, refreshes } = start({ kill: () => Promise.reject(new Error('job is gone')) })

    actor.send({ type: 'arm', id: 'job-1' })
    actor.send({ type: 'stop' })
    await waitFor(actor, snapshot => snapshot.matches('error'))
    expect(actor.getSnapshot().context.armedId).toBe('job-1')
    expect(actor.getSnapshot().context.targetIds).toEqual([])
    expect(actor.getSnapshot().context.failure).toMatchObject({ kind: 'error' })
    expect(refreshes).toHaveLength(0)
    actor.stop()
  })

  it('refuses a batch confirmation without a selection', () => {
    const { actor } = start()
    actor.send({ type: 'ask' })
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    actor.stop()
  })

  it('keeps the selection model in the machine, pruned to the visible rows', () => {
    const { actor } = start()
    select(actor, ['job-1', 'job-2'])
    expect(actor.getSnapshot().context.selection.ids).toEqual(['job-1', 'job-2'])

    actor.send({ type: 'visible', ids: ['job-2'] })
    expect(actor.getSnapshot().context.selection.ids).toEqual(['job-2'])

    actor.send({ type: 'select.clear' })
    expect(actor.getSnapshot().context.selection.ids).toEqual([])
    actor.stop()
  })

  it('cancels a batch confirmation without stopping anything', () => {
    const ids: string[] = []
    const { actor } = start({
      kill: jobId => {
        ids.push(jobId)
        return Promise.resolve(killed)
      },
    })
    select(actor, ['job-1', 'job-2'])

    actor.send({ type: 'ask' })
    expect(actor.getSnapshot().matches('confirming')).toBe(true)
    expect(actor.getSnapshot().context.targetIds).toEqual(['job-1', 'job-2'])

    actor.send({ type: 'cancel' })
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(actor.getSnapshot().context.targetIds).toEqual([])
    expect(ids).toEqual([])
    actor.stop()
  })

  it('stops the captured batch and clears the selection', async () => {
    const ids: string[] = []
    const { actor, refreshes } = start({
      kill: jobId => {
        ids.push(jobId)
        return Promise.resolve(killed)
      },
    })
    select(actor, ['job-1', 'job-2'])
    actor.send({ type: 'ask' })
    actor.send({ type: 'confirm' })
    expect(actor.getSnapshot().matches({ stopping: 'batch' })).toBe(true)

    await waitFor(actor, snapshot => snapshot.matches('idle'))
    expect(ids).toEqual(['job-1', 'job-2'])
    expect(actor.getSnapshot().context.selection.ids).toEqual([])
    expect(actor.getSnapshot().context.failure).toBeNull()
    expect(refreshes).toHaveLength(1)
    actor.stop()
  })

  it('keeps only the failed ids selected after a partial batch failure', async () => {
    const ids: string[] = []
    const { actor, refreshes } = start({
      kill: jobId => {
        ids.push(jobId)
        return jobId === 'job-2' ? Promise.reject(new Error('job is gone')) : Promise.resolve(killed)
      },
    })
    select(actor, ['job-1', 'job-2'])
    actor.send({ type: 'ask' })
    actor.send({ type: 'confirm' })

    await waitFor(actor, snapshot => snapshot.matches('confirming'))
    expect(actor.getSnapshot().context.failure).toEqual({ kind: 'batch', requested: 1, failed: 1 })
    expect(actor.getSnapshot().context.selection.ids).toEqual(['job-2'])
    expect(actor.getSnapshot().context.targetIds).toEqual(['job-2'])
    expect(refreshes).toHaveLength(1)

    ids.length = 0
    actor.send({ type: 'confirm' })
    await waitFor(actor, snapshot => snapshot.matches('confirming'))
    expect(ids).toEqual(['job-2'])
    actor.stop()
  })
})
