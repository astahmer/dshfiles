import { createActor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it, vi } from 'vitest'
import { resumeAllUsageLimitsMachine, type ResumeAllUsageLimitClient, type ResumeAllUsageLimitSettled } from './resume-all-usage-limits-machine.js'

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

describe('resume all usage limits machine', () => {
  it('limits concurrency, ignores duplicate starts, and returns each result in input order', async () => {
    const started: string[] = []
    const requests = new Map<string, Deferred<{ readonly accepted: boolean }>>()
    let active = 0
    let maximumActive = 0
    const client: ResumeAllUsageLimitClient = {
      resumeQuotaContinuation: (input, { signal }) => {
        started.push(input.continuationId)
        active += 1
        maximumActive = Math.max(maximumActive, active)
        const request = deferred<{ readonly accepted: boolean }>()
        requests.set(input.continuationId, request)
        signal.addEventListener('abort', () => request.reject(new Error('Aborted')), { once: true })
        return request.promise.finally(() => {
          active -= 1
        })
      },
    }
    const actor = createActor(resumeAllUsageLimitsMachine, { input: { client } })
    const settled: ResumeAllUsageLimitSettled[] = []
    actor.on('settled', event => settled.push(event))
    actor.start()
    actor.send({ type: 'start', continuationIds: ['a', 'b', 'c', 'd', 'e', 'a'] })
    await vi.waitFor(() => expect(started).toHaveLength(3))

    actor.send({ type: 'start', continuationIds: ['ignored'] })
    expect(started).toHaveLength(3)
    requests.get('a')?.resolve({ accepted: true })
    requests.get('b')?.resolve({ accepted: false })
    requests.get('c')?.reject(new Error('Host unavailable'))
    await vi.waitFor(() => expect(started).toHaveLength(5))
    requests.get('d')?.resolve({ accepted: true })
    requests.get('e')?.resolve({ accepted: true })
    await vi.waitFor(() => expect(settled).toHaveLength(1))

    expect(maximumActive).toBe(3)
    expect(settled[0]).toEqual({
      type: 'settled',
      operationId: 1,
      results: [
        { continuationId: 'a', status: 'accepted' },
        { continuationId: 'b', status: 'rejected' },
        { continuationId: 'c', status: 'failed' },
        { continuationId: 'd', status: 'accepted' },
        { continuationId: 'e', status: 'accepted' },
      ],
    })
    actor.stop()
  })

  it('aborts active Host requests and emits no stale completion when stopped', async () => {
    const signals: AbortSignal[] = []
    const client: ResumeAllUsageLimitClient = {
      resumeQuotaContinuation: (_input, { signal }) => {
        signals.push(signal)
        return new Promise<{ readonly accepted: boolean }>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })
        })
      },
    }
    const actor = createActor(resumeAllUsageLimitsMachine, { input: { client } })
    const settled: ResumeAllUsageLimitSettled[] = []
    actor.on('settled', event => settled.push(event))
    actor.start()
    actor.send({ type: 'start', continuationIds: ['a', 'b', 'c', 'd'] })
    await vi.waitFor(() => expect(signals).toHaveLength(3))

    actor.stop()
    expect(signals.every(signal => signal.aborted)).toBe(true)
    await Promise.resolve()
    expect(settled).toEqual([])
  })
})
