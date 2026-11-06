import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it, vi } from 'vitest'
import { provideRestartMachine, waitForNewHost, type RestartClient, type RestartPending } from './restart-machine.js'

type Availability = Awaited<ReturnType<RestartClient['availability']>>

const PENDING: RestartPending = { since: 1, running: 1 }

/** A Host whose `run` the test changes; `down` makes availability fail like a Host that stopped answering. */
const fakeHosts = (initialRun: string | undefined) => {
  const state: { run: string | undefined; down: boolean; pending: RestartPending | null } = { run: initialRun, down: false, pending: null }
  const availability: RestartClient['availability'] = async () => {
    if (state.down) throw new Error('unreachable')
    const answer: Availability = { available: true, pending: state.pending }
    return state.run === undefined ? answer : { ...answer, run: state.run }
  }
  return { state, availability }
}

const startRestart = (input: {
  readonly requestRestart?: RestartClient['requestRestart']
  readonly requestRestartWhenIdle?: RestartClient['requestRestartWhenIdle']
  readonly cancelPendingRestart?: RestartClient['cancelPendingRestart']
  readonly availability?: RestartClient['availability']
  readonly stallMs?: number
}) =>
  createActor(provideRestartMachine(), {
    input: {
      client: {
        requestRestart: input.requestRestart ?? (async () => ({ accepted: true })),
        requestRestartWhenIdle: input.requestRestartWhenIdle ?? (async () => ({ accepted: true })),
        cancelPendingRestart: input.cancelPendingRestart ?? (async () => ({ canceled: true })),
        availability: input.availability ?? fakeHosts('old').availability,
      },
      pollMs: 1,
      stallMs: input.stallMs ?? 10_000,
    },
  }).start()

describe('restartMachine', () => {
  it('opens the confirmation and cancels without requesting a restart', () => {
    let requests = 0
    const actor = startRestart({
      requestRestart: async () => {
        requests += 1
        return { accepted: true }
      },
    })
    actor.send({ type: 'open' })
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(actor.getSnapshot().context.dialogOpen).toBe(true)
    actor.send({ type: 'cancel' })
    expect(actor.getSnapshot().context.dialogOpen).toBe(false)
    expect(requests).toBe(0)
    actor.stop()
  })

  it('requests a restart, waits for the new Host and closes once a new run answers', async () => {
    const hosts = fakeHosts('old')
    let requestSignal: AbortSignal | undefined
    let signalWasAbortedAtCall: boolean | undefined
    const actor = startRestart({
      requestRestart: async (_input, options) => {
        requestSignal = options?.signal
        signalWasAbortedAtCall = options?.signal?.aborted
        hosts.state.down = true
        return { accepted: true }
      },
      availability: hosts.availability,
    })
    actor.send({ type: 'open' })
    actor.send({ type: 'confirm' })
    await waitFor(actor, snapshot => snapshot.matches('restarting'))
    expect(actor.getSnapshot().context.previousRun).toBe('old')
    expect(actor.getSnapshot().context.dialogOpen).toBe(true)
    expect(requestSignal).toBeInstanceOf(AbortSignal)
    expect(signalWasAbortedAtCall).toBe(false)
    hosts.state.down = false
    hosts.state.run = 'new'
    await waitFor(actor, snapshot => snapshot.matches('idle'))
    expect(actor.getSnapshot().context.dialogOpen).toBe(false)
    actor.stop()
  })

  it('says the Host did not come back after the stall limit, and keeps waiting when asked', async () => {
    const hosts = fakeHosts('old')
    const actor = startRestart({
      requestRestart: async () => ({ accepted: true }),
      availability: hosts.availability,
      stallMs: 20,
    })
    actor.send({ type: 'open' })
    actor.send({ type: 'confirm' })
    await waitFor(actor, snapshot => snapshot.matches('stalled'))
    actor.send({ type: 'retry' })
    expect(actor.getSnapshot().matches('restarting')).toBe(true)
    hosts.state.run = 'new'
    await waitFor(actor, snapshot => snapshot.matches('idle'))
    actor.stop()
  })

  // Before this flow lived in the machine, the page watched it through refs keyed on the availability query.
  it('asks the Host to restart when idle, follows the pending restart and watches the new Host once it drains', async () => {
    const hosts = fakeHosts('old')
    let idleRequests = 0
    const actor = startRestart({
      requestRestartWhenIdle: async () => {
        idleRequests += 1
        return { accepted: true }
      },
      availability: hosts.availability,
    })
    actor.send({ type: 'open' })
    actor.send({ type: 'whenIdle' })
    await waitFor(actor, snapshot => snapshot.matches('draining'))
    expect(idleRequests).toBe(1)
    expect(actor.getSnapshot().context.dialogOpen).toBe(false)

    hosts.state.pending = PENDING
    await vi.waitFor(() => expect(actor.getSnapshot().context.pending).toEqual(PENDING))

    hosts.state.pending = null
    hosts.state.run = 'new'
    await waitFor(actor, snapshot => snapshot.matches('restarting'))
    expect(actor.getSnapshot().context.previousRun).toBe('old')
    await waitFor(actor, snapshot => snapshot.matches('idle'))
    expect(actor.getSnapshot().context.pending).toBeNull()
    actor.stop()
  })

  it('opens and closes the dialog over a pending restart without losing the wait', async () => {
    const hosts = fakeHosts('old')
    const actor = startRestart({ availability: hosts.availability })
    actor.send({ type: 'open' })
    actor.send({ type: 'whenIdle' })
    await waitFor(actor, snapshot => snapshot.matches('draining'))
    hosts.state.pending = PENDING
    await vi.waitFor(() => expect(actor.getSnapshot().context.pending).toEqual(PENDING))

    actor.send({ type: 'open' })
    await waitFor(actor, snapshot => snapshot.matches({ draining: 'prompted' }))
    expect(actor.getSnapshot().context.dialogOpen).toBe(true)
    actor.send({ type: 'cancel' })
    await waitFor(actor, snapshot => snapshot.matches({ draining: 'dismissed' }))
    expect(actor.getSnapshot().context.dialogOpen).toBe(false)

    hosts.state.pending = null
    hosts.state.run = 'new'
    await waitFor(actor, snapshot => snapshot.matches('restarting'))
    actor.stop()
  })

  it('calls off a restart waiting for idle without watching for a new Host', async () => {
    const hosts = fakeHosts('old')
    let canceled = 0
    const actor = startRestart({
      availability: hosts.availability,
      cancelPendingRestart: async () => {
        canceled += 1
        return { canceled: true }
      },
    })
    actor.send({ type: 'open' })
    actor.send({ type: 'whenIdle' })
    await waitFor(actor, snapshot => snapshot.matches('draining'))
    hosts.state.pending = PENDING
    await vi.waitFor(() => expect(actor.getSnapshot().context.pending).toEqual(PENDING))

    actor.send({ type: 'open' })
    await waitFor(actor, snapshot => snapshot.matches({ draining: 'prompted' }))
    actor.send({ type: 'cancelWhenIdle' })
    await waitFor(actor, snapshot => snapshot.matches('idle'))
    expect(canceled).toBe(1)
    expect(actor.getSnapshot().context.pending).toBeNull()
    expect(actor.getSnapshot().context.dialogOpen).toBe(true)
    actor.stop()
  })

  it('follows a pending restart this page did not request', async () => {
    const hosts = fakeHosts('old')
    hosts.state.pending = PENDING
    const actor = startRestart({ availability: hosts.availability })
    actor.send({ type: 'pendingSeen', pending: PENDING })
    await waitFor(actor, snapshot => snapshot.matches('draining'))
    expect(actor.getSnapshot().context.pending).toEqual(PENDING)
    hosts.state.pending = null
    hosts.state.run = 'new'
    await waitFor(actor, snapshot => snapshot.matches('restarting'))
    actor.stop()
  })

  it('opens the dialog with the failure when the Host refuses a restart when idle', async () => {
    const actor = startRestart({ requestRestartWhenIdle: async () => Promise.reject(new Error('unavailable')) })
    actor.send({ type: 'open' })
    actor.send({ type: 'whenIdle' })
    await waitFor(actor, snapshot => snapshot.matches('failed'))
    expect(actor.getSnapshot().context.dialogOpen).toBe(true)
    actor.send({ type: 'retry' })
    expect(actor.getSnapshot().matches('failed')).toBe(true)
    actor.stop()
  })

  it('shows failure and permits one explicit retry', async () => {
    let attempts = 0
    const actor = startRestart({
      requestRestart: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('restart unavailable')
        return { accepted: true }
      },
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
    const actor = startRestart({
      requestRestart: (_input, options) => {
        requestSignal = options?.signal
        return new Promise(resolve => {
          resolveRequest = () => resolve({ accepted: true })
        })
      },
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
