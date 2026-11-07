import { describe, expect, it, vi } from 'vitest'
import { landRepositoriesApi, type LocalLandApi, type RemoteLandPort } from './land-repositories.js'

const thread = (path: string, sessionIds: readonly string[]) => ({ path, name: 'thread-a', sessionIds, unlanded: [] })
const repository = (title: string, threads: readonly ReturnType<typeof thread>[]) => ({ title, repoRoot: `/${title}`, workspaceId: null, threads })

const fixture = () => {
  const local = {
    repositories: vi.fn(async () => ({ repositories: [repository('here', [thread('/local/thread', ['session-local'])])] })),
    land: vi.fn(async () => ({ status: 'landed' })),
    integrationProgress: vi.fn(async () => ({ phase: 'idle' })),
    discard: vi.fn(async () => ({ status: 'discarded', revisions: [] })),
  }
  const remote = {
    remoteRepositories: vi.fn<RemoteLandPort['remoteRepositories']>(async () => ({
      // SAFETY: the fixture carries only the fields this module reads.
      hosts: [
        {
          runtimeId: 'runtime-a',
          hostName: 'Studio',
          refreshing: false,
          repositories: [repository('there', [thread('/remote/thread', ['session-a', 'session-b'])])] as never,
        },
      ],
      unreachable: ['Laptop'],
    })),
    sessionJjCall: vi.fn<RemoteLandPort['sessionJjCall']>(async () => ({ ok: true, value: { status: 'discarded', revisions: [] } })),
  }
  // SAFETY: as above, for this Host's calls.
  return { local, remote, api: landRepositoriesApi({ local: local as never as LocalLandApi, remote }) }
}

describe('the Land page across machines', () => {
  it('lists remote repositories under their host and says which hosts did not answer', async () => {
    const { api } = fixture()
    const merged = await api.repositories({})
    expect(merged.repositories.map(item => item.title)).toEqual(['here', 'there · Studio'])
    expect(merged.unreachableHosts).toEqual(['Laptop'])
    expect(api.isRemote('/remote/thread')).toBe(true)
    expect(api.isRemote('/local/thread')).toBe(false)
  })

  it('keeps the page refreshing while a host is still scanning', async () => {
    const { api, remote } = fixture()
    remote.remoteRepositories.mockResolvedValueOnce({
      hosts: [{ runtimeId: 'runtime-a', hostName: 'Studio', refreshing: true, repositories: [] }],
      unreachable: [],
    })
    await expect(api.repositories({})).resolves.toMatchObject({ refreshing: true })
  })

  it('still lists this machine when the remote read fails, and says the list may be incomplete', async () => {
    const { api, remote } = fixture()
    remote.remoteRepositories.mockRejectedValueOnce(new Error('offline'))
    const merged = await api.repositories({})
    expect(merged.repositories.map(item => item.title)).toEqual(['here'])
    expect(merged.unreachableHosts).toEqual(['Remote hosts'])
  })

  it('removes a remote thread through one of its Sessions, and a local one on this Host', async () => {
    const { api, local, remote } = fixture()
    await api.repositories({})
    await api.discard({ path: '/remote/thread', force: false })
    expect(remote.sessionJjCall.mock.calls[0]?.[0]).toEqual({ sessionId: 'session-a', method: 'discard', input: { path: '/remote/thread', force: false } })
    await api.discard({ path: '/local/thread', force: false })
    expect(local.discard).toHaveBeenCalledOnce()
    expect(remote.sessionJjCall).toHaveBeenCalledOnce()
  })

  it("keeps the owner's refusal", async () => {
    const { api, remote } = fixture()
    await api.repositories({})
    remote.sessionJjCall.mockResolvedValueOnce({ ok: false, code: 'integration-queued', message: 'Queued.' })
    await expect(api.land({ path: '/remote/thread' })).rejects.toMatchObject({ remoteCode: 'integration-queued', message: 'Queued.' })
  })

  it('refuses a reply outside the contract', async () => {
    const { api, remote } = fixture()
    await api.repositories({})
    remote.sessionJjCall.mockResolvedValueOnce({ ok: true, value: { status: 'gone' } })
    await expect(api.discard({ path: '/remote/thread', force: false })).rejects.toThrow()
  })
})
