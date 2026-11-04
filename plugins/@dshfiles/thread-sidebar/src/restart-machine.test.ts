import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it, vi } from 'vitest'
import { provideRestartMachine, waitForNewHost, type RestartClient } from './restart-machine.js'

type Availability = Awaited<ReturnType<RestartClient['availability']>>

/** A Host whose `run` the test changes; `down` makes availability fail like a Host that stopped answering. */
const fakeHosts = (initialRun: string | undefined) => {
  const state = { run: initialRun, down: false }
  const availability: RestartClient['availability'] = async () => {
    if (state.down) throw new Error('unreachable')
    const answer: Availability = { available: true, pending: null }
    return state.run === undefined ? answer : { ...answer, run: state.run }
  }
  return { state, availability }
}

const startRestart = (requestRestart: RestartClient['requestRestart'], availability: RestartClient['availability'] = fakeHosts('old').availability) =>
  createActor(provideRestartMachine(), { input: { client: { requestRestart, availability }, pollMs: 1, stallMs: 10_000 } }).start()

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

  it('requests a restart, waits for the new Host and closes once a new run answers', async () => {
    const hosts = fakeHosts('old')
    let requestSignal: AbortSignal | undefined
    let signalWasAbortedAtCall: boolean | undefined
    const actor = startRestart(async (_input, options) => {
      requestSignal = options?.signal
      signalWasAbortedAtCall = options?.signal?.aborted
      hosts.state.down = true
      return { accepted: true }
    }, hosts.availability)
    actor.send({ type: 'open' })
    actor.send({ type: 'confirm' })
    await waitFor(actor, snapshot => snapshot.matches('restarting'))
    expect(actor.getSnapshot().context.previousRun).toBe('old')
    expect(requestSignal).toBeInstanceOf(AbortSignal)
    expect(signalWasAbortedAtCall).toBe(false)
    hosts.state.down = false
    hosts.state.run = 'new'
    await waitFor(actor, snapshot => snapshot.matches('closed'))
    actor.stop()
  })

  it('says the Host did not come back after the stall limit, and keeps waiting when asked', async () => {
    const hosts = fakeHosts('old')
    const actor = createActor(provideRestartMachine(), {
      input: { client: { requestRestart: async () => ({ accepted: true }), availability: hosts.availability }, pollMs: 1, stallMs: 20 },
    }).start()
    actor.send({ type: 'open' })
    actor.send({ type: 'confirm' })
    await waitFor(actor, snapshot => snapshot.matches('stalled'))
    actor.send({ type: 'retry' })
    expect(actor.getSnapshot().matches('restarting')).toBe(true)
    hosts.state.run = 'new'
    await waitFor(actor, snapshot => snapshot.matches('closed'))
    actor.stop()
  })

  it('watches a restart started elsewhere (Restart when idle) like its own', async () => {
    const hosts = fakeHosts('old')
    const actor = startRestart(async () => ({ accepted: true }), hosts.availability)
    actor.send({ type: 'watch', run: 'old' })
    expect(actor.getSnapshot().matches('restarting')).toBe(true)
    hosts.state.run = 'new'
    await waitFor(actor, snapshot => snapshot.matches('closed'))
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
    await waitFor(actor, snapshot => snapshot.matches('restarting'))
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

describe('waitForNewHost', () => {
  it('treats an older Host without a run as new only after it went away and answered again', async () => {
    const hosts = fakeHosts(undefined)
    const controller = new AbortController()
    let done = false
    const waiting = waitForNewHost({ client: hosts, previousRun: undefined, pollMs: 1, signal: controller.signal }).then(() => {
      done = true
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(done).toBe(false)
    hosts.state.down = true
    await new Promise(resolve => setTimeout(resolve, 20))
    hosts.state.down = false
    await waiting
    expect(done).toBe(true)
  })
})
