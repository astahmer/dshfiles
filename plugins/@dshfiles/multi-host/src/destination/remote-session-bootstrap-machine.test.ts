import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { remoteSessionBootstrapMachine, type BootstrapFailure } from './remote-session-bootstrap-machine.js'

const failureSchema = Schema.Struct({ message: Schema.String, code: Schema.optional(Schema.String) })

const describeFailure = (error: unknown): BootstrapFailure => {
  const parsed = Schema.decodeUnknownResult(failureSchema)(error)
  return parsed._tag === 'Success' ? parsed.success : { message: 'Could not start a thread on host.' }
}

const start = (input: { readonly target: string; readonly create: () => Promise<string>; readonly onStarted: (sessionId: string) => void | Promise<void> }) =>
  createActor(remoteSessionBootstrapMachine, { input: { ...input, describeFailure } })

describe('remote session bootstrap', () => {
  it('opens the Session it created', async () => {
    const opened: string[] = []
    const actor = start({
      target: 'runtime-a\u0000/first',
      create: async () => 'session-1',
      onStarted: sessionId => {
        opened.push(sessionId)
      },
    })
    actor.start()
    await waitFor(actor, snapshot => snapshot.matches('started'))
    expect(opened).toEqual(['session-1'])
  })

  it('starts a new Session on the next visit even though opening unmounted the first screen', async () => {
    const target = 'runtime-a\u0000/visited-twice'
    let creates = 0
    const create = async () => {
      creates += 1
      return `session-${String(creates)}`
    }
    const opened: string[] = []
    const first = start({
      target,
      create,
      // Opening a thread leaves the New thread screen, which stops this machine before its own transition runs.
      onStarted: sessionId => {
        opened.push(sessionId)
        first.stop()
      },
    })
    first.start()
    await expect.poll(() => opened).toEqual(['session-1'])

    const second = start({ target, create, onStarted: sessionId => void opened.push(sessionId) })
    second.start()
    await waitFor(second, snapshot => snapshot.matches('started'))
    expect(opened).toEqual(['session-1', 'session-2'])
  })

  it('retries a refused create from scratch', async () => {
    let creates = 0
    const opened: string[] = []
    const actor = start({
      target: 'runtime-a\u0000/refused',
      create: async () => {
        creates += 1
        if (creates === 1) throw { message: 'Host refused', code: 'host-refused' } satisfies BootstrapFailure
        return 'session-2'
      },
      onStarted: sessionId => {
        opened.push(sessionId)
      },
    })
    actor.start()
    await waitFor(actor, snapshot => snapshot.matches('failed'))
    expect(actor.getSnapshot().context.failure).toEqual({ message: 'Host refused', code: 'host-refused' })
    actor.send({ type: 'retry' })
    await waitFor(actor, snapshot => snapshot.matches('started'))
    expect(creates).toBe(2)
    expect(opened).toEqual(['session-2'])
  })

  it('reuses the Session the first attempt created when opening it fails', async () => {
    let creates = 0
    let opens = 0
    const actor = start({
      target: 'runtime-a\u0000/opening',
      create: async () => {
        creates += 1
        return 'session-3'
      },
      onStarted: async () => {
        opens += 1
        if (opens === 1) throw new Error('Could not open the thread')
      },
    })
    actor.start()
    await waitFor(actor, snapshot => snapshot.matches('failed'))
    expect(actor.getSnapshot().context.failure).toEqual({ message: 'Could not open the thread' })
    actor.send({ type: 'retry' })
    await waitFor(actor, snapshot => snapshot.matches('started'))
    expect(creates).toBe(1)
    expect(opens).toBe(2)
  })

  it('never retries an unknown mutation outcome', async () => {
    let creates = 0
    const actor = start({
      target: 'runtime-a\u0000/unknown',
      create: async () => {
        creates += 1
        throw { message: 'Outcome unknown', code: 'unknown-mutation-outcome' } satisfies BootstrapFailure
      },
      onStarted: () => undefined,
    })
    actor.start()
    await waitFor(actor, snapshot => snapshot.matches('unrecoverable'))
    actor.send({ type: 'retry' })
    expect(actor.getSnapshot().matches('unrecoverable')).toBe(true)
    expect(creates).toBe(1)
  })
})
