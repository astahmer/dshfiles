import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { RemoteThreadStore, type RemoteThread } from '../src/thread-store.js'

const thread = (sessionId: string, title: string): RemoteThread => ({
  runtimeId: 'runtime',
  sessionId,
  cwd: '/tmp/fixture',
  title,
  createdAt: '2026-10-16T00:00:00.000Z',
})

test('records, lists, replaces, and forgets remote threads in the plugin store', async () => {
  const home = await mkdtemp(join(tmpdir(), 'multi-host-thread-store-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const first = thread('session-1', 'first')
  const updated = thread('session-1', 'updated')
  const second = thread('session-2', 'second')

  try {
    expect(await RemoteThreadStore.record(first)).toEqual(first)
    expect(await RemoteThreadStore.record(updated)).toEqual(updated)
    expect(await RemoteThreadStore.record(second)).toEqual(second)
    expect(await RemoteThreadStore.list()).toEqual([updated, second])
    expect(await RemoteThreadStore.forget({ runtimeId: 'runtime', sessionId: 'session-1' })).toBe(1)
    expect(await RemoteThreadStore.list()).toEqual([second])
    expect(await RemoteThreadStore.forget({ runtimeId: 'runtime' })).toBe(1)
    expect(await RemoteThreadStore.list()).toEqual([])
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})
