import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import { IntegrationRecovery } from './integration-recovery.js'
import { sessionThreadApi, type SessionThreadRemote } from './session-thread-api.js'

const local = () => ({
  threadAt: vi.fn(async () => ({ thread: null })),
  land: vi.fn(async () => ({ status: 'landed' }) as never),
  queueLand: vi.fn(async () => ({ queuedAt: 1 }) as never),
  cancelQueuedLand: vi.fn(async () => ({ status: 'cancelled' }) as never),
})

const remote = (runtimeId: string | null, value: { readonly thread: string | null } = { thread: null }) => {
  const sessionRuntime = vi.fn<SessionThreadRemote['sessionRuntime']>(async () => ({ ok: true, runtimeId }))
  const sessionJjCall = vi.fn<SessionThreadRemote['sessionJjCall']>(async () => ({ ok: true, value }))
  return { sessionRuntime, sessionJjCall }
}

const path = '/remote/project'
const sessionId = SessionId('session-a')

describe('the JJ thread actions of one Session', () => {
  it('stays on this Host for a Session it owns', async () => {
    const hosts = { local: local(), remote: remote(null) }
    const api = sessionThreadApi({ ...hosts, sessionId })
    await api.threadAt({ path })
    expect(hosts.local.threadAt).toHaveBeenCalledWith({ path }, undefined)
    expect(hosts.remote.sessionJjCall).not.toHaveBeenCalled()
  })

  it('goes to the owner for a mirrored Session, and never asks this Host about a path it does not have', async () => {
    const hosts = { local: local(), remote: remote('runtime-a') }
    const api = sessionThreadApi({ ...hosts, sessionId })
    await expect(api.threadAt({ path, sessionId: 'session-a' })).resolves.toEqual({ thread: null })
    expect(hosts.remote.sessionJjCall).toHaveBeenCalledWith({ sessionId: 'session-a', method: 'threadAt', input: { path, sessionId: 'session-a' } }, undefined)
    expect(hosts.local.threadAt).not.toHaveBeenCalled()
  })

  it('reads ownership once per Session', async () => {
    const hosts = { local: local(), remote: remote('runtime-a') }
    const api = sessionThreadApi({ ...hosts, sessionId })
    await api.threadAt({ path })
    await api.threadAt({ path })
    expect(hosts.remote.sessionRuntime).toHaveBeenCalledTimes(1)
  })

  it('asks again after a failed ownership read', async () => {
    const hosts = { local: local(), remote: remote('runtime-a') }
    hosts.remote.sessionRuntime.mockResolvedValueOnce({ ok: false, message: 'Host unreachable.' })
    const api = sessionThreadApi({ ...hosts, sessionId })
    await expect(api.threadAt({ path })).rejects.toThrow('Host unreachable.')
    await expect(api.threadAt({ path })).resolves.toEqual({ thread: null })
  })

  it("keeps the owner's refusal code, so a queued integration is still recognized", async () => {
    const hosts = { local: local(), remote: remote('runtime-a') }
    hosts.remote.sessionJjCall.mockResolvedValueOnce({ ok: false, code: 'integration-queued', message: 'Queued.' })
    const api = sessionThreadApi({ ...hosts, sessionId })
    const refusal = await api.land({ path, sessionId: 'session-a' }).catch((error: unknown) => error)
    expect(refusal).toMatchObject({ message: 'Queued.' })
    expect(IntegrationRecovery.isQueued(refusal)).toBe(true)
  })

  it('refuses a reply outside the contract instead of showing it', async () => {
    const hosts = { local: local(), remote: remote('runtime-a', { thread: 'not a thread' }) }
    const api = sessionThreadApi({ ...hosts, sessionId })
    await expect(api.threadAt({ path })).rejects.toThrow()
  })
})
