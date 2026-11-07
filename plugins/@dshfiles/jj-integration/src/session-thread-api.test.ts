import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { IntegrationRecovery } from './integration-recovery.js'
import { sessionThreadApi, type SessionThreadRemote } from './session-thread-api.js'

type Local = Parameters<typeof sessionThreadApi>[0]['local']
type Ownership = Awaited<ReturnType<SessionThreadRemote['sessionRuntime']>>
type JjReply = Awaited<ReturnType<SessionThreadRemote['sessionJjCall']>>

const local = () => {
  const threadAtCalls: Parameters<Local['threadAt']>[] = []
  const fake: Local = {
    threadAt: async (...args) => {
      threadAtCalls.push(args)
      return { thread: null }
    },
    // SAFETY: these tests never read the results of the land calls on this Host.
    land: async () => ({ status: 'landed' }) as never,
    queueLand: async () => ({ queuedAt: 1 }) as never,
    cancelQueuedLand: async () => ({ status: 'cancelled' }) as never,
  }
  return { fake, threadAtCalls }
}

const remote = (runtimeId: string | null, value: { readonly thread: string | null } = { thread: null }) => {
  const calls = { ownership: 0, jj: [] as Parameters<SessionThreadRemote['sessionJjCall']>[] }
  /** Replies used once each, before the default. */
  const ownershipReplies: Ownership[] = []
  const jjReplies: JjReply[] = []
  const fake: SessionThreadRemote = {
    sessionRuntime: async () => {
      calls.ownership += 1
      return ownershipReplies.shift() ?? { ok: true, runtimeId }
    },
    sessionJjCall: async (...args) => {
      calls.jj.push(args)
      return jjReplies.shift() ?? { ok: true, value }
    },
  }
  return { fake, calls, ownershipReplies, jjReplies }
}

const setup = (owner: ReturnType<typeof remote>) => {
  const here = local()
  return { here, owner, api: sessionThreadApi({ local: here.fake, remote: owner.fake, sessionId }) }
}

const path = '/remote/project'
const sessionId = SessionId('session-a')

describe('the JJ thread actions of one Session', () => {
  it('stays on this Host for a Session it owns', async () => {
    const { api, here, owner } = setup(remote(null))
    await api.threadAt({ path })
    expect(here.threadAtCalls).toEqual([[{ path }, undefined]])
    expect(owner.calls.jj).toEqual([])
  })

  it('goes to the owner for a mirrored Session, and never asks this Host about a path it does not have', async () => {
    const { api, here, owner } = setup(remote('runtime-a'))
    await expect(api.threadAt({ path, sessionId: 'session-a' })).resolves.toEqual({ thread: null })
    expect(owner.calls.jj).toEqual([[{ sessionId: 'session-a', method: 'threadAt', input: { path, sessionId: 'session-a' } }, undefined]])
    expect(here.threadAtCalls).toEqual([])
  })

  it('reads ownership once per Session', async () => {
    const { api, owner } = setup(remote('runtime-a'))
    await api.threadAt({ path })
    await api.threadAt({ path })
    expect(owner.calls.ownership).toBe(1)
  })

  it('asks again after a failed ownership read', async () => {
    const owner = remote('runtime-a')
    owner.ownershipReplies.push({ ok: false, message: 'Host unreachable.' })
    const { api } = setup(owner)
    await expect(api.threadAt({ path })).rejects.toThrow('Host unreachable.')
    await expect(api.threadAt({ path })).resolves.toEqual({ thread: null })
  })

  it("keeps the owner's refusal code, so a queued integration is still recognized", async () => {
    const owner = remote('runtime-a')
    owner.jjReplies.push({ ok: false, code: 'integration-queued', message: 'Queued.' })
    const { api } = setup(owner)
    const refusal = await api.land({ path, sessionId: 'session-a' }).catch((error: unknown) => error)
    expect(refusal).toMatchObject({ message: 'Queued.' })
    expect(IntegrationRecovery.isQueued(refusal)).toBe(true)
  })

  it('refuses a reply outside the contract instead of showing it', async () => {
    const { api } = setup(remote('runtime-a', { thread: 'not a thread' }))
    await expect(api.threadAt({ path })).rejects.toThrow()
  })
})
