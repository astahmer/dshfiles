import { describe, expect, it } from 'vitest'
import { landRepositoriesApi, type LocalLandApi, type RemoteLandPort } from './land-repositories.js'

const thread = (path: string, sessionIds: readonly string[]) => ({ path, name: 'thread-a', sessionIds, unlanded: [] })
const repository = (title: string, threads: readonly ReturnType<typeof thread>[]) => ({ title, repoRoot: `/${title}`, workspaceId: null, threads })

type RemoteHosts = Awaited<ReturnType<RemoteLandPort['remoteRepositories']>>
type JjCall = Parameters<RemoteLandPort['sessionJjCall']>[0]
type JjReply = Awaited<ReturnType<RemoteLandPort['sessionJjCall']>>

const fixture = () => {
  const calls = { localDiscards: 0, jj: [] as JjCall[] }
  const hosts: RemoteHosts = {
    hosts: [
      {
        runtimeId: 'runtime-a',
        hostName: 'Studio',
        refreshing: false,
        // SAFETY: the fixture carries only the fields this module reads.
        repositories: [repository('there', [thread('/remote/thread', ['session-a', 'session-b'])])] as never,
      },
    ],
    unreachable: ['Laptop'],
  }
  let readHosts = async (): Promise<RemoteHosts> => hosts
  let jjReply: JjReply = { ok: true, value: { status: 'discarded', revisions: [] } }
  const local = {
    repositories: async () => ({ repositories: [repository('here', [thread('/local/thread', ['session-local'])])] }),
    land: async () => ({ status: 'landed' }),
    integrationProgress: async () => ({ phase: 'idle' }),
    discard: async () => {
      calls.localDiscards += 1
      return { status: 'discarded', revisions: [] }
    },
  }
  const remote: RemoteLandPort = {
    remoteRepositories: () => readHosts(),
    sessionJjCall: async input => {
      calls.jj.push(input)
      return jjReply
    },
  }
  return {
    calls,
    /** The next remote repository reads answer this way. */
    remoteHostsRead: (read: () => Promise<RemoteHosts>) => {
      readHosts = read
    },
    /** The owner answers the next JJ calls this way. */
    ownerReplies: (reply: JjReply) => {
      jjReply = reply
    },
    // SAFETY: the local fake carries only the fields this module reads.
    api: landRepositoriesApi({ local: local as never as LocalLandApi, remote }),
  }
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
    const { api, remoteHostsRead } = fixture()
    remoteHostsRead(async () => ({ hosts: [{ runtimeId: 'runtime-a', hostName: 'Studio', refreshing: true, repositories: [] }], unreachable: [] }))
    await expect(api.repositories({})).resolves.toMatchObject({ refreshing: true })
  })

  it('still lists this machine when the remote read fails, and says the list may be incomplete', async () => {
    const { api, remoteHostsRead } = fixture()
    remoteHostsRead(async () => {
      throw new Error('offline')
    })
    const merged = await api.repositories({})
    expect(merged.repositories.map(item => item.title)).toEqual(['here'])
    expect(merged.unreachableHosts).toEqual(['Remote hosts'])
  })

  it('removes a remote thread through one of its Sessions, and a local one on this Host', async () => {
    const { api, calls } = fixture()
    await api.repositories({})
    await api.discard({ path: '/remote/thread', force: false })
    expect(calls.jj).toEqual([{ sessionId: 'session-a', method: 'discard', input: { path: '/remote/thread', force: false } }])
    await api.discard({ path: '/local/thread', force: false })
    expect(calls.localDiscards).toBe(1)
    expect(calls.jj).toHaveLength(1)
  })

  it("keeps the owner's refusal", async () => {
    const { api, ownerReplies } = fixture()
    await api.repositories({})
    ownerReplies({ ok: false, code: 'integration-queued', message: 'Queued.' })
    await expect(api.land({ path: '/remote/thread' })).rejects.toMatchObject({ remoteCode: 'integration-queued', message: 'Queued.' })
  })

  it('refuses a reply outside the contract', async () => {
    const { api, ownerReplies } = fixture()
    await api.repositories({})
    ownerReplies({ ok: true, value: { status: 'gone' } })
    await expect(api.discard({ path: '/remote/thread', force: false })).rejects.toThrow()
  })
})
