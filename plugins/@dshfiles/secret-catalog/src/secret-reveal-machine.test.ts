import { createActor, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSecretRevealActor, secretRevealMachine, type SecretRevealClient, type SecretRevealRequest } from './secret-reveal-machine.js'

type PendingCall = {
  readonly signal: AbortSignal | undefined
  readonly resolve: (value: string) => void
  readonly reject: () => void
}

const deferred = () => {
  let resolve: (value: string) => void = () => undefined
  let reject: () => void = () => undefined
  const promise = new Promise<string>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = () => rejectPromise(new Error('synthetic private detail'))
  })
  return { promise, resolve, reject }
}

const requestFor = (alias: string): SecretRevealRequest => ({ alias, cwd: null, scope: 'global', environment: 'prod' })

const callAt = (calls: readonly PendingCall[], index: number): PendingCall => {
  const call = calls[index]
  if (call === undefined) throw new Error(`Reveal call ${index} was not started.`)
  return call
}

const harness = () => {
  const calls: PendingCall[] = []
  const client: SecretRevealClient = {
    reveal: async (_payload, options) => {
      const pending = deferred()
      calls.push({ signal: options?.signal, resolve: pending.resolve, reject: pending.reject })
      return pending.promise
    },
  }
  const machine = secretRevealMachine.provide({ actors: { revealSecret: createSecretRevealActor(client) } })
  const actor = createActor(machine).start()
  return { actor, calls }
}

const waitForState = (actor: ActorRefFrom<typeof secretRevealMachine>, state: 'visible' | 'failed'): Promise<void> => {
  if (actor.getSnapshot().matches(state)) return Promise.resolve()
  return new Promise(resolve => {
    let unsubscribe = (): void => undefined
    const finish = (): void => {
      unsubscribe()
      resolve()
    }
    const subscription = actor.subscribe(snapshot => {
      if (snapshot.matches(state)) finish()
    })
    unsubscribe = () => subscription.unsubscribe()
    if (actor.getSnapshot().matches(state)) finish()
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('secretRevealMachine', () => {
  it('replaces a pending reveal and only exposes the latest operation', async () => {
    const { actor, calls } = harness()
    actor.send({ type: 'toggle', rowId: 'row-old', payload: requestFor('OLD_ALIAS'), revealMs: 1000 })
    actor.send({ type: 'toggle', rowId: 'row-current', payload: requestFor('CURRENT_ALIAS'), revealMs: 1000 })

    expect(calls).toHaveLength(2)
    expect(callAt(calls, 0).signal?.aborted).toBe(true)
    const visible = waitForState(actor, 'visible')
    callAt(calls, 0).resolve('stale-value')
    callAt(calls, 1).resolve('current-value')
    await visible

    expect(actor.getSnapshot().context.revealed).toEqual({ rowId: 'row-current', value: 'current-value' })
    actor.stop()
  })

  it('aborts a pending reveal on hide and discards a late value', async () => {
    const { actor, calls } = harness()
    actor.send({ type: 'toggle', rowId: 'row-1', payload: requestFor('ALIAS'), revealMs: 1000 })
    const pending = callAt(calls, 0)

    actor.send({ type: 'hide' })
    expect(pending.signal?.aborted).toBe(true)
    pending.resolve('late-secret')
    await Promise.resolve()

    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(actor.getSnapshot().context.revealed).toBeNull()
    actor.stop()
  })

  it('lets the user hide the visible row and clears the value after its time limit', async () => {
    vi.useFakeTimers()
    const { actor, calls } = harness()
    actor.send({ type: 'toggle', rowId: 'row-1', payload: requestFor('ALIAS'), revealMs: 200 })
    const visible = waitForState(actor, 'visible')
    callAt(calls, 0).resolve('secret-value')
    await visible
    expect(actor.getSnapshot().context.revealed).toEqual({ rowId: 'row-1', value: 'secret-value' })

    actor.send({ type: 'toggle', rowId: 'row-1', payload: requestFor('ALIAS'), revealMs: 200 })
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(actor.getSnapshot().context.revealed).toBeNull()

    actor.send({ type: 'toggle', rowId: 'row-1', payload: requestFor('ALIAS'), revealMs: 200 })
    const revealedAgain = waitForState(actor, 'visible')
    callAt(calls, 1).resolve('secret-value')
    await revealedAgain
    await vi.advanceTimersByTimeAsync(200)

    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(actor.getSnapshot().context.revealed).toBeNull()
    actor.stop()
  })

  it('keeps reveal errors generic and allows a retry', async () => {
    const { actor, calls } = harness()
    actor.send({ type: 'toggle', rowId: 'row-1', payload: requestFor('ALIAS'), revealMs: 1000 })
    const failed = waitForState(actor, 'failed')
    callAt(calls, 0).reject()
    await failed
    expect(actor.getSnapshot().context.revealed).toBeNull()

    actor.send({ type: 'toggle', rowId: 'row-1', payload: requestFor('ALIAS'), revealMs: 1000 })
    const visible = waitForState(actor, 'visible')
    callAt(calls, 1).resolve('retried-secret')
    await visible

    expect(actor.getSnapshot().context.revealed).toEqual({ rowId: 'row-1', value: 'retried-secret' })
    actor.stop()
  })
})
