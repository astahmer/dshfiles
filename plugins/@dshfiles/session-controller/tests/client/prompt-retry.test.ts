import { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it } from 'vitest'
import { Session } from '../../src/native/client/sessions/session.js'
import type { SessionRemotes } from '../../src/native/client/sessions/remotes.js'

/** The tests drive only `session.prompt`; a Session reads nothing else of the remotes on these paths. */
// SAFETY: the partial remotes object is the exact subset Session reads, assembled here rather than from a Host.
const sessionRemotes = (prompt: SessionRemotes['session']['prompt']): SessionRemotes => ({ session: { prompt } }) as SessionRemotes

const sessionWithPrompt = (prompt: SessionRemotes['session']['prompt'], options: ConstructorParameters<typeof Session>[2] = {}): Session =>
  new Session(SessionId('session-retry-test'), sessionRemotes(prompt), options)

const text = [{ type: 'text', text: 'hello' }] as const

describe('Session.prompt retry', () => {
  it('never prompts after cancellation while the local draft is materializing', async () => {
    let attempts = 0
    const created = Promise.withResolvers<void>()
    const controller = new AbortController()
    const session = sessionWithPrompt(
      async () => {
        attempts += 1
        return { ok: true, value: { accepted: true } }
      },
      { beforeRpc: () => created.promise },
    )
    const sending = session.prompt([...text], 'queue', controller.signal)
    controller.abort(new Error('cancelled materialization'))
    created.resolve()
    await expect(sending).rejects.toThrow('cancelled materialization')
    expect(attempts).toBe(0)
  })

  it('retries a gateway failure once with the submission request ID', async () => {
    const requestIds: string[] = []
    const session = sessionWithPrompt(async request => {
      requestIds.push(request.requestId)
      if (requestIds.length === 1) return { ok: false, error: new RemoteError('gateway/internal', 'temporary transport failure', {}) }
      return { ok: true, value: { accepted: true } }
    })
    const submission = session.beginSubmission({ mode: 'queue', text: 'hello', attachments: [] })

    await expect(session.prompt([...text], 'queue', undefined, submission.requestId)).resolves.toEqual({
      ok: true,
      value: { accepted: true },
    })
    expect(requestIds).toEqual([submission.requestId, submission.requestId])
  })

  it('does not retry a business rejection', async () => {
    let attempts = 0
    const session = sessionWithPrompt(async () => {
      attempts += 1
      return { ok: false, error: new RemoteError('session/agent-busy', 'prompt rejected', { reason: 'BUSY' }) }
    })

    await expect(session.prompt([...text], 'queue')).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/agent-busy' },
    })
    expect(attempts).toBe(1)
  })

  it('caps transport retries at one additional attempt', async () => {
    let attempts = 0
    const session = sessionWithPrompt(async () => {
      attempts += 1
      return { ok: false, error: new RemoteError('gateway/internal', 'transport still unavailable', {}) }
    })

    await expect(session.prompt([...text], 'queue')).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/internal' },
    })
    expect(attempts).toBe(2)
  })
})
