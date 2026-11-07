import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Schema } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OwnerRouting, type OwnerPort } from './owner-routed-api.js'

const sessionId = SessionId('session-a')
const methods = { load: { output: Schema.Struct({ root: Schema.String }) } }

const fixture = (runtimeId: string | null, value: { readonly root: string | number } = { root: '/remote/repo' }) => {
  const load = vi.fn(async () => ({ root: '/local/repo' }))
  const sessionRuntime = vi.fn<OwnerPort['sessionRuntime']>(async () => ({ ok: true, runtimeId }))
  const sessionRepositoryCall = vi.fn<OwnerPort['sessionRepositoryCall']>(async () => ({ ok: true, value }))
  const api = OwnerRouting.api({ local: { load, label: 'local' }, api: 'jujutsu', methods, owner: { sessionRuntime, sessionRepositoryCall }, sessionId })
  return { api, load, sessionRepositoryCall, sessionRuntime }
}

describe('a repository client bound to one Session', () => {
  beforeEach(() => {
    OwnerRouting.forget()
  })

  it('stays on this Host for a Session it owns', async () => {
    const { api, load, sessionRepositoryCall } = fixture(null)
    await expect(api.load()).resolves.toEqual({ root: '/local/repo' })
    expect(load).toHaveBeenCalledOnce()
    expect(sessionRepositoryCall).not.toHaveBeenCalled()
  })

  it('goes to the owner for a mirrored Session, once per Session for the owner read', async () => {
    const { api, load, sessionRepositoryCall, sessionRuntime } = fixture('runtime-a')
    await expect(api.load()).resolves.toEqual({ root: '/remote/repo' })
    await api.load()
    expect(load).not.toHaveBeenCalled()
    expect(sessionRuntime).toHaveBeenCalledOnce()
    expect(sessionRepositoryCall.mock.calls[0]?.[0]).toMatchObject({ sessionId, api: 'jujutsu', method: 'load' })
  })

  it('keeps the rest of the client as it is', () => {
    expect(fixture(null).api.label).toBe('local')
  })

  it("keeps the owner's refusal code and message", async () => {
    const { api, sessionRepositoryCall } = fixture('runtime-a')
    sessionRepositoryCall.mockResolvedValueOnce({ ok: false, code: 'session/path-mismatch', message: 'Not this folder.' })
    await expect(api.load()).rejects.toMatchObject({ remoteCode: 'session/path-mismatch', message: 'Not this folder.' })
  })

  it('refuses a reply outside the contract', async () => {
    await expect(fixture('runtime-a', { root: 7 }).api.load()).rejects.toThrow()
  })

  it('asks again after a failed owner read', async () => {
    const { api, sessionRuntime } = fixture('runtime-a')
    sessionRuntime.mockResolvedValueOnce({ ok: false, message: 'Host unreachable.' })
    await expect(api.load()).rejects.toThrow('Host unreachable.')
    await expect(api.load()).resolves.toEqual({ root: '/remote/repo' })
  })
})
