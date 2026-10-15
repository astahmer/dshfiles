import { createActor, fromPromise, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { welcomeNoticeMachine, type WelcomeNoticeScopeState } from './welcome-notice-machine.js'

type PersistInput = { readonly write: () => Promise<boolean> }

const providedMachine = welcomeNoticeMachine.provide({
  actors: {
    persistAcknowledgement: fromPromise<boolean, PersistInput>(({ input }) => input.write()),
  },
})

const start = (scope: WelcomeNoticeScopeState, write: () => Promise<boolean>) => {
  const actor = createActor(providedMachine, { input: { scope, write } })
  actor.start()
  return actor
}

const hostScope = (input: Partial<WelcomeNoticeScopeState> = {}): WelcomeNoticeScopeState => ({
  mode: 'host',
  status: 'ready',
  acknowledged: false,
  ...input,
})

const deferred = <Value,>() => {
  let resolve = (_value: Value): void => {}
  const promise = new Promise<Value>(onResolve => {
    resolve = onResolve
  })
  return { promise, resolve }
}

describe('welcome notice machine', () => {
  it('keeps an acknowledgement process-local when the settings scope is in memory', () => {
    let writes = 0
    const actor = start({ mode: 'memory', status: 'unavailable', acknowledged: false }, async () => {
      writes += 1
      return true
    })

    expect(actor.getSnapshot().matches('ready')).toBe(true)
    actor.send({ type: 'acknowledge' })

    expect(actor.getSnapshot().context.acknowledged).toBe(true)
    expect(writes).toBe(0)
    actor.stop()
  })

  it('waits for the settings scope, then mirrors an accepted acknowledgement', async () => {
    const actor = start(hostScope({ status: 'loading' }), async () => true)
    expect(actor.getSnapshot().matches('loading')).toBe(true)

    actor.send({ type: 'scope.changed', scope: hostScope({ acknowledged: true }) })
    await waitFor(actor, snapshot => snapshot.context.acknowledged)

    expect(actor.getSnapshot().matches('ready')).toBe(true)
    actor.stop()
  })

  it('shows a refusal and permits a successful retry', async () => {
    let writes = 0
    const actor = start(hostScope(), async () => {
      writes += 1
      return writes > 1
    })

    actor.send({ type: 'acknowledge' })
    await waitFor(actor, snapshot => snapshot.matches('error'))
    expect(actor.getSnapshot().context.error).toBe('the acknowledgement did not persist')

    actor.send({ type: 'acknowledge' })
    await waitFor(actor, snapshot => snapshot.context.acknowledged)

    expect(writes).toBe(2)
    expect(actor.getSnapshot().matches('ready')).toBe(true)
    actor.stop()
  })

  it('recovers from a transport rejection on retry', async () => {
    let writes = 0
    const actor = start(hostScope(), async () => {
      writes += 1
      if (writes === 1) throw new Error('transport unavailable')
      return true
    })

    actor.send({ type: 'acknowledge' })
    await waitFor(actor, snapshot => snapshot.matches('error'))
    actor.send({ type: 'acknowledge' })
    await waitFor(actor, snapshot => snapshot.context.acknowledged)

    expect(writes).toBe(2)
    actor.stop()
  })

  it('accepts a concurrent settings update even when its own write is refused', async () => {
    const request = deferred<boolean>()
    const actor = start(hostScope(), () => request.promise)

    actor.send({ type: 'acknowledge' })
    actor.send({ type: 'scope.changed', scope: hostScope({ acknowledged: true }) })
    request.resolve(false)
    await waitFor(actor, snapshot => snapshot.context.acknowledged)

    expect(actor.getSnapshot().matches('ready')).toBe(true)
    actor.stop()
  })

  it('ignores a late completion after the actor stops', async () => {
    const request = deferred<boolean>()
    const actor = start(hostScope(), () => request.promise)
    actor.send({ type: 'acknowledge' })
    expect(actor.getSnapshot().matches('saving')).toBe(true)

    actor.stop()
    request.resolve(true)
    await Promise.resolve()

    expect(actor.getSnapshot().context.acknowledged).toBe(false)
  })
})
