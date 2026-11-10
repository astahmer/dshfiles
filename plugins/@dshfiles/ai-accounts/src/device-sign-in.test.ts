import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it, vi } from 'vitest'
import { deviceSignInMachine, ownsDeviceSignIn, type DeviceSignInPorts, type DeviceSignInStatus } from './device-sign-in.js'

const deferred = <Value>() => {
  let settle: ((value: Value) => void) | undefined
  const promise = new Promise<Value>(resolve => {
    settle = resolve
  })
  return {
    promise,
    resolve: (value: Value): void => {
      if (settle === undefined) throw new Error('Deferred result was not initialized')
      settle(value)
    },
  }
}

const harness = (overrides: Partial<DeviceSignInPorts> = {}) => {
  const connected = vi.fn()
  const cancelled = vi.fn()
  const begin = vi.fn<DeviceSignInPorts['begin']>(async () => ({ status: 'waiting' }))
  const cancel = vi.fn<DeviceSignInPorts['cancel']>(async () => undefined)
  const ports: DeviceSignInPorts = { begin, cancel, onConnected: connected, onCancelled: cancelled, ...overrides }
  const actor = createActor(deviceSignInMachine, { input: { ports: { read: () => ports } } })
  actor.start()
  return { actor, begin, cancel, connected, cancelled }
}

describe('device sign-in flow', () => {
  it('connects once when the device is approved and ignores later status reads', async () => {
    const view = harness()
    view.actor.send({ type: 'begin' })
    await waitFor(view.actor, snapshot => snapshot.matches('polling'))
    view.actor.send({ type: 'observed', status: 'waiting' })
    expect(view.actor.getSnapshot().matches('polling')).toBe(true)
    view.actor.send({ type: 'observed', status: 'complete' })
    expect(view.actor.getSnapshot().matches('connected')).toBe(true)
    expect(view.connected).toHaveBeenCalledOnce()
    view.actor.send({ type: 'observed', status: 'complete' })
    expect(view.connected).toHaveBeenCalledOnce()
    view.actor.send({ type: 'begin' })
    expect(view.actor.getSnapshot().matches('connected')).toBe(true)
  })

  it('never lets a stale status read connect before the begin result arrives', async () => {
    const begun = deferred<DeviceSignInStatus>()
    const view = harness({ begin: () => begun.promise })
    view.actor.send({ type: 'begin' })
    view.actor.send({ type: 'observed', status: 'complete' })
    expect(view.actor.getSnapshot().matches('starting')).toBe(true)
    expect(view.connected).not.toHaveBeenCalled()
    begun.resolve({ status: 'starting' })
    await waitFor(view.actor, snapshot => snapshot.matches('polling'))
    expect(view.connected).not.toHaveBeenCalled()
  })

  it('stays ready for a pre-existing completion that this mount did not start', () => {
    const view = harness()
    view.actor.send({ type: 'observed', status: 'complete' })
    expect(view.actor.getSnapshot().matches('ready')).toBe(true)
    expect(view.connected).not.toHaveBeenCalled()
  })

  it('retries after a begin error and after a cancelled attempt', async () => {
    const view = harness()
    view.begin.mockRejectedValueOnce(new Error('Host unavailable'))
    view.actor.send({ type: 'begin' })
    await waitFor(view.actor, snapshot => snapshot.matches('failed'))
    expect(view.actor.getSnapshot().context.failure).toBe('begin')
    view.actor.send({ type: 'begin' })
    await waitFor(view.actor, snapshot => snapshot.matches('polling'))
    expect(view.actor.getSnapshot().context.failure).toBeNull()
  })

  it('cancels a pending attempt, notifies once, and keeps the flow open for a retry', async () => {
    const view = harness()
    view.actor.send({ type: 'begin' })
    await waitFor(view.actor, snapshot => snapshot.matches('polling'))
    view.actor.send({ type: 'cancel' })
    await waitFor(view.actor, snapshot => snapshot.matches('cancelled'))
    expect(view.cancel).toHaveBeenCalledOnce()
    expect(view.cancelled).toHaveBeenCalledOnce()
    view.actor.send({ type: 'begin' })
    await waitFor(view.actor, snapshot => snapshot.matches('polling'))
  })

  it('keeps ownership when a cancel request fails', async () => {
    const view = harness()
    view.cancel.mockRejectedValueOnce(new Error('Host unavailable'))
    view.actor.send({ type: 'begin' })
    await waitFor(view.actor, snapshot => snapshot.matches('polling'))
    view.actor.send({ type: 'cancel' })
    await waitFor(view.actor, snapshot => snapshot.matches('polling'))
    expect(view.actor.getSnapshot().context.failure).toBe('cancel')
    expect(view.cancelled).not.toHaveBeenCalled()
  })

  it('signs out and back in through the disconnect states', async () => {
    const signOut = vi.fn<() => Promise<void>>(async () => undefined)
    const view = harness({ signOut })
    view.actor.send({ type: 'signOut' })
    await waitFor(view.actor, snapshot => snapshot.matches('ready'))
    expect(signOut).toHaveBeenCalledOnce()
    expect(view.actor.getSnapshot().context.failure).toBeNull()
    signOut.mockRejectedValueOnce(new Error('Host unavailable'))
    view.actor.send({ type: 'signOut' })
    await waitFor(view.actor, snapshot => snapshot.context.failure === 'signOut')
    expect(view.actor.getSnapshot().matches('ready')).toBe(true)
  })

  it('offers no disconnect for a provider without one', () => {
    const view = harness()
    view.actor.send({ type: 'signOut' })
    expect(view.actor.getSnapshot().matches('ready')).toBe(true)
  })

  it('ignores a begin result that lands after the flow was reset', async () => {
    const begun = deferred<DeviceSignInStatus>()
    const view = harness({ begin: () => begun.promise })
    view.actor.send({ type: 'begin' })
    view.actor.send({ type: 'reset' })
    expect(view.actor.getSnapshot().matches('ready')).toBe(true)
    begun.resolve({ status: 'waiting' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(view.actor.getSnapshot().matches('ready')).toBe(true)
    expect(view.connected).not.toHaveBeenCalled()
  })

  it('treats only starting and polling as owned by the mounted component', () => {
    expect(['ready', 'starting', 'polling', 'cancelling', 'connected', 'cancelled', 'failed', 'disconnecting'].map(ownsDeviceSignIn)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ])
  })
})
