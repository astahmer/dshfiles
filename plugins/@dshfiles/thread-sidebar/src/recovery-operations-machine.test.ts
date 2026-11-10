import { createActor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_CONCURRENT_RECOVERY_OPERATIONS,
  recoveryOperationsMachine,
  type RecoveryOperation,
  type RecoveryOperationsSettled,
} from './recovery-operations-machine.js'

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

const startMachine = () => {
  const actor = createActor(recoveryOperationsMachine).start()
  const settled: RecoveryOperationsSettled[] = []
  actor.on('settled', event => settled.push(event))
  return { actor, settled }
}

describe('recovery operations machine', () => {
  it('limits concurrency, ignores duplicate keys, and returns each result in input order', async () => {
    const started: string[] = []
    const requests = new Map<string, Deferred<{ readonly accepted: boolean }>>()
    let active = 0
    let maximumActive = 0
    const operation = (key: string): RecoveryOperation => ({
      key,
      run: ({ signal }) => {
        started.push(key)
        active += 1
        maximumActive = Math.max(maximumActive, active)
        const request = deferred<{ readonly accepted: boolean }>()
        requests.set(key, request)
        signal.addEventListener('abort', () => request.reject(new Error('Aborted')), { once: true })
        return request.promise.finally(() => {
          active -= 1
        })
      },
    })
    const { actor, settled } = startMachine()
    actor.send({ type: 'run', tag: 'usage-limit-batch', operations: ['a', 'b', 'c', 'd', 'e', 'a'].map(operation) })
    await vi.waitFor(() => expect(started).toHaveLength(MAX_CONCURRENT_RECOVERY_OPERATIONS))

    actor.send({ type: 'run', tag: 'usage-limit-row', operations: [operation('a')] })
    expect(started).toHaveLength(MAX_CONCURRENT_RECOVERY_OPERATIONS)
    requests.get('a')?.resolve({ accepted: true })
    requests.get('b')?.resolve({ accepted: false })
    requests.get('c')?.reject(new Error('Host unavailable'))
    await vi.waitFor(() => expect(started).toHaveLength(5))
    requests.get('d')?.resolve({ accepted: true })
    requests.get('e')?.resolve({ accepted: true })
    await vi.waitFor(() => expect(settled).toHaveLength(1))

    expect(maximumActive).toBe(MAX_CONCURRENT_RECOVERY_OPERATIONS)
    expect(settled[0]).toEqual({
      type: 'settled',
      tag: 'usage-limit-batch',
      results: [
        { key: 'a', status: 'accepted' },
        { key: 'b', status: 'rejected' },
        { key: 'c', status: 'failed' },
        { key: 'd', status: 'accepted' },
        { key: 'e', status: 'accepted' },
      ],
    })
    actor.stop()
  })

  // Before this machine owned the flow, a row action carried its own busy set and either duplicated or lost a click.
  it('queues a row operation started during a batch, keeping its key busy until it settles', async () => {
    const batches: string[] = []
    const requests = new Map<string, Deferred<{ readonly accepted: boolean }>>()
    const operation = (key: string): RecoveryOperation => ({
      key,
      run: () => {
        batches.push(key)
        const request = deferred<{ readonly accepted: boolean }>()
        requests.set(key, request)
        return request.promise
      },
    })
    const { actor, settled } = startMachine()
    actor.send({ type: 'run', tag: 'usage-limit-batch', operations: [operation('a')] })
    actor.send({ type: 'run', tag: 'usage-limit-change', operations: [operation('b')] })

    expect(actor.getSnapshot().context.busyKeys).toEqual(['a', 'b'])
    expect(batches).toEqual(['a'])
    requests.get('a')?.resolve({ accepted: true })
    await vi.waitFor(() => expect(batches).toEqual(['a', 'b']))
    expect(actor.getSnapshot().context.busyKeys).toEqual(['b'])
    requests.get('b')?.resolve({ accepted: true })
    await vi.waitFor(() => expect(settled.map(event => event.tag)).toEqual(['usage-limit-batch', 'usage-limit-change']))
    expect(actor.getSnapshot().context.busyKeys).toEqual([])
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    actor.stop()
  })

  it('aborts active Host requests and emits no stale completion when stopped', async () => {
    const signals: AbortSignal[] = []
    const operation = (key: string): RecoveryOperation => ({
      key,
      run: ({ signal }) => {
        signals.push(signal)
        return new Promise<{ readonly accepted: boolean }>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })
        })
      },
    })
    const { actor, settled } = startMachine()
    actor.send({ type: 'run', tag: 'usage-limit-batch', operations: ['a', 'b', 'c', 'd'].map(operation) })
    await vi.waitFor(() => expect(signals).toHaveLength(MAX_CONCURRENT_RECOVERY_OPERATIONS))

    actor.stop()
    expect(signals.every(signal => signal.aborted)).toBe(true)
    await Promise.resolve()
    expect(settled).toEqual([])
  })
})
