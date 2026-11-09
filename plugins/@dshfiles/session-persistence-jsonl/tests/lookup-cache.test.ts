import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Plugin } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import * as ForkedJsonl from '../src/host.ts'
import { logPath } from '../src/native/format.ts'

const fsCalls = vi.hoisted(() => ({ readdir: [] as string[], open: [] as string[] }))

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: ((path: string, ...rest: []) => {
      fsCalls.readdir.push(String(path))
      return actual.readdir(path, ...rest)
    }) as typeof actual.readdir,
    open: ((path: string, ...rest: []) => {
      fsCalls.open.push(String(path))
      return actual.open(path, ...rest)
    }) as typeof actual.open,
  }
})

const roots: string[] = []
const disposers: (() => Promise<void>)[] = []

beforeEach(() => {
  fsCalls.readdir.length = 0
  fsCalls.open.length = 0
})

afterEach(async () => {
  await Promise.all(disposers.splice(0).map(dispose => dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dshfiles-jsonl-lookup-'))
  roots.push(root)
  return root
}

const backend = async (plugin: Plugin, root: string): Promise<SessionPersistence> => {
  const ctx = new Context()
  const fiber = await ctx.plugin(plugin, { root, compression: 'zstd' })
  disposers.push(() => fiber.dispose())
  return ctx.sessionPersistence
}

const writeSession = async (persistence: SessionPersistence, id: string, cwd: string): Promise<void> => {
  const handle = await persistence.create({
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: 1_760_000_000_000,
    cwd,
    isSeeded: false,
    delegationDepth: 0,
  })
  await handle.append([{ type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 1 } }])
  await handle.close()
}

const appendTurnEnd = async (persistence: SessionPersistence, id: string): Promise<void> => {
  const handle = await persistence.open(SessionId(id), 'write')
  await handle.append([{ type: 'turn/end', seq: SessionSeq(1), time: 1, data: { turn: 1, reason: { kind: 'completed' } } }])
  await handle.close()
}

describe('session lookup', () => {
  it('reads only the known session directory on a repeated lookup', async () => {
    const root = await makeRoot()
    const persistence = await backend(ForkedJsonl, root)
    for (let index = 0; index < 5; index += 1) await writeSession(persistence, `session-${index}`, `/tmp/project-${index}`)
    const reader = await backend(ForkedJsonl, root)
    expect((await reader.stat(SessionId('session-3')))?.header.cwd).toBe('/tmp/project-3')

    fsCalls.readdir.length = 0
    expect((await reader.stat(SessionId('session-3')))?.header.cwd).toBe('/tmp/project-3')

    expect(fsCalls.readdir).toEqual([dirname(logPath(root, '/tmp/project-3', SessionId('session-3'), 'zstd'))])
  })

  it('scans again when the known directory no longer holds the session', async () => {
    const root = await makeRoot()
    const persistence = await backend(ForkedJsonl, root)
    await writeSession(persistence, 'session-moved', '/tmp/project-a')
    expect((await persistence.stat(SessionId('session-moved')))?.header.cwd).toBe('/tmp/project-a')

    await rm(dirname(logPath(root, '/tmp/project-a', SessionId('session-moved'), 'zstd')), { recursive: true })
    expect(await persistence.stat(SessionId('session-moved'))).toBeUndefined()

    await writeSession(await backend(ForkedJsonl, root), 'session-moved', '/tmp/project-b')
    fsCalls.readdir.length = 0
    expect((await persistence.stat(SessionId('session-moved')))?.header.cwd).toBe('/tmp/project-b')
    expect(fsCalls.readdir).toContain(root)
  })
})

describe('session listing', () => {
  it('decodes each unchanged header once and again after the log changes', async () => {
    const root = await makeRoot()
    const persistence = await backend(ForkedJsonl, root)
    await writeSession(persistence, 'session-a', '/tmp/project-a')
    await writeSession(persistence, 'session-b', '/tmp/project-b')
    const pathA = logPath(root, '/tmp/project-a', SessionId('session-a'), 'zstd')
    const pathB = logPath(root, '/tmp/project-b', SessionId('session-b'), 'zstd')
    await persistence.list()

    fsCalls.open.length = 0
    await persistence.list()
    expect(fsCalls.open.filter(path => path === pathA || path === pathB)).toEqual([])

    await appendTurnEnd(await backend(ForkedJsonl, root), 'session-a')
    fsCalls.open.length = 0
    await persistence.list()
    expect(fsCalls.open.filter(path => path === pathA || path === pathB)).toEqual([pathA])
  })

  it('lists what a cold backend lists, unaffected by a caller mutating a previous result', async () => {
    const root = await makeRoot()
    const persistence = await backend(ForkedJsonl, root)
    await writeSession(persistence, 'session-a', '/tmp/project-a')
    await writeSession(persistence, 'session-b', '/tmp/project-b')
    await appendTurnEnd(persistence, 'session-b')
    const byId = (snapshots: Awaited<ReturnType<SessionPersistence['list']>>) =>
      [...snapshots].sort((left, right) => left.header.id.localeCompare(right.header.id))

    await persistence.list()
    const warm = byId(await persistence.list())
    const cold = byId(await (await backend(ForkedJsonl, root)).list())
    expect(cold.map(snapshot => snapshot.header.id)).toEqual(['session-a', 'session-b'])
    expect(warm).toEqual(cold)
    expect(await persistence.stat(SessionId('session-b'))).toEqual(cold[1])

    Object.assign(warm[0]!.header, { cwd: '/tmp/mutated' })
    expect(byId(await persistence.list())).toEqual(cold)
  })
})
