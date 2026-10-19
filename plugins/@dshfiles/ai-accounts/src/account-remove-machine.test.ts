import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { accountRemoveMachine, type AccountRemovalPort, type AccountRemovalTarget } from './account-remove-machine.js'

const target: AccountRemovalTarget = { instanceId: 'codex-work', displayName: 'Work Codex' }

const start = (removeAccount: AccountRemovalPort) => {
  const actor = createActor(accountRemoveMachine, { input: { removeAccount } })
  actor.start()
  return actor
}

const deferred = <Value>() => {
  let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined
  const promise = new Promise<Value>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('account removal machine', () => {
  it('cancels before confirmation without calling the Host', () => {
    let calls = 0
    const actor = start(async () => {
      calls += 1
    })

    actor.send({ type: 'request', target })
    expect(actor.getSnapshot().matches('confirming')).toBe(true)
    actor.send({ type: 'cancel' })

    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(actor.getSnapshot().context.target).toBeNull()
    expect(calls).toBe(0)
    actor.stop()
  })

  it('removes the captured target and ignores stale completion events', async () => {
    const pending = deferred<void>()
    const calls: AccountRemovalTarget[] = []
    const actor = start(async removalTarget => {
      calls.push(removalTarget)
      await pending.promise
    })

    actor.send({ type: 'request', target })
    actor.send({ type: 'confirm' })
    await Promise.resolve()

    expect(calls).toEqual([target])
    expect(actor.getSnapshot().matches('removing')).toBe(true)
    actor.send({ type: 'request', target: { instanceId: 'other-account', displayName: 'Other Account' } })
    expect(actor.getSnapshot().context.target).toEqual(target)
    actor.send({ type: 'remove.completed', operationId: 0 })
    expect(actor.getSnapshot().matches('removing')).toBe(true)

    pending.resolve(undefined)
    await waitFor(actor, snapshot => snapshot.matches('removed'))
    expect(actor.getSnapshot().context.operationId).toBe(1)
    actor.stop()
  })

  it('recovers from a rejected removal and retries the same target', async () => {
    let attempts = 0
    const removedTargets: AccountRemovalTarget[] = []
    const actor = start(async removalTarget => {
      attempts += 1
      removedTargets.push(removalTarget)
      if (attempts === 1) throw new Error('Host unavailable')
    })

    actor.send({ type: 'request', target })
    actor.send({ type: 'confirm' })
    await waitFor(actor, snapshot => snapshot.matches('error'))

    expect(actor.getSnapshot().context.operationId).toBe(1)
    actor.send({ type: 'retry' })
    await waitFor(actor, snapshot => snapshot.matches('removed'))

    expect(attempts).toBe(2)
    expect(removedTargets).toEqual([target, target])
    expect(actor.getSnapshot().context.operationId).toBe(2)
    actor.stop()
  })

  it('ignores the late view result but preserves the external mutation after the view stops', async () => {
    const pending = deferred<void>()
    const states: Array<string | object> = []
    const updatedCache: AccountRemovalTarget[] = []
    const actor = start(async removalTarget => {
      await pending.promise
      updatedCache.push(removalTarget)
    })
    actor.subscribe(snapshot => states.push(snapshot.value))

    actor.send({ type: 'request', target })
    actor.send({ type: 'confirm' })
    await Promise.resolve()
    expect(actor.getSnapshot().matches('removing')).toBe(true)

    actor.stop()
    pending.resolve(undefined)
    await Promise.resolve()
    await Promise.resolve()

    expect(states.some(state => state === 'removed')).toBe(false)
    expect(updatedCache).toEqual([target])
  })
})
