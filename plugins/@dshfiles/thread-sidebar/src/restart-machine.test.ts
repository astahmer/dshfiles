import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it, vi } from 'vitest'
import { provideRestartMachine, type RestartClient } from './restart-machine.js'

const startRestart = (requestRestart: RestartClient['requestRestart']) =>
  createActor(provideRestartMachine(), { input: { client: { requestRestart } } }).start()

describe('restartMachine', () => {
  it('opens the confirmation and cancels without requesting a restart', () => {
    let requests = 0
    const actor = startRestart(async () => {
      requests += 1
      return { accepted: true }
    })
    actor.send({ type: 'open' })
    expect(actor.getSnapshot().matches('confirming')).toBe(true)
    actor.send({ type: 'cancel' })
    expect(actor.getSnapshot().matches('closed')).toBe(true)
    expect(requests).toBe(0)
    actor.stop()
  })

  it('requests a restart and closes the confirmation after success', async () => {
    let requestSignal: AbortSignal | undefined
    let signalWasAbortedAtCall: boolean | undefined
    const actor = startRestart(async (_input, options) => {
      requestSignal = options?.signal
      signalWasAbortedAtCall = options?.signal?.aborted
      return { accepted: true }
    })
    actor.send({ type: 'open' })
    actor.send({ type: 'confirm' })
    await waitFor(actor, snapshot => snapshot.matches('closed'))
    expect(requestSignal).toBeInstanceOf(AbortSignal)
    expect(signalWasAbortedAtCall).toBe(false)
    actor.stop()
  })

  it('shows failure and permits one explicit retry', async () => {
    let attempts = 0
    const actor = startRestart(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('restart unavailable')
      return { accepted: true }
    })
    actor.send({ type: 'open' })
    actor.send({ type: 'confirm' })
    await waitFor(actor, snapshot => snapshot.matches('failed'))
    actor.send({ type: 'confirm' })
    await waitFor(actor, snapshot => snapshot.matches('closed'))
    expect(attempts).toBe(2)
    actor.stop()
  })

  it('aborts a pending request when the actor stops and ignores its late completion', async () => {
    let requestSignal: AbortSignal | undefined
    let resolveRequest: (() => void) | undefined
    const actor = startRestart((_input, options) => {
      requestSignal = options?.signal
      return new Promise(resolve => {
        resolveRequest = () => resolve({ accepted: true })
      })
    })
    actor.send({ type: 'open' })
    actor.send({ type: 'confirm' })
    await waitFor(actor, snapshot => snapshot.matches('requesting'))
    await vi.waitFor(() => expect(requestSignal).toBeDefined())
    actor.stop()
    await vi.waitFor(() => expect(requestSignal?.aborted).toBe(true))
    resolveRequest?.()
    await Promise.resolve()
    expect(actor.getSnapshot().matches('requesting')).toBe(true)
  })
})
