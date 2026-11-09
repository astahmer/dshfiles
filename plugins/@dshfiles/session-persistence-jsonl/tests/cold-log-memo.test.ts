import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import * as ForkedJsonl from '../src/host.ts'
import { logPath } from '../src/native/format.ts'

const readFiles = vi.hoisted(() => [] as string[])

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: ((path: string, ...rest: []) => {
      readFiles.push(String(path))
      return actual.readFile(path, ...rest)
    }) as typeof actual.readFile,
  }
})

const roots: string[] = []
const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(disposers.splice(0).map(dispose => dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const backend = async (root: string): Promise<SessionPersistence> => {
  const ctx = new Context()
  const fiber = await ctx.plugin(ForkedJsonl, { root, compression: 'zstd' })
  disposers.push(() => fiber.dispose())
  return ctx.sessionPersistence
}

const storedSession = async (payload: string): Promise<{ root: string, path: string, id: SessionId }> => {
  const root = await mkdtemp(join(tmpdir(), 'dshfiles-jsonl-memo-'))
  roots.push(root)
  const id = SessionId('session-memo')
  const handle = await (await backend(root)).create({
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 1_760_000_000_000,
    cwd: '/tmp/project-memo',
    isSeeded: false,
    delegationDepth: 0,
  })
  await handle.append([
    { type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 1 } },
    {
      type: 'request/header',
      seq: SessionSeq(1),
      time: 1,
      data: {
        header: {
          config: { provider: 'fixture', model: 'fixture-model' },
          tools: [{ name: 'payload', description: payload, parameters: { type: 'object', properties: {} } }],
        },
        reason: 'initial',
      },
    },
  ])
  await handle.close()
  return { root, path: logPath(root, '/tmp/project-memo', id, 'zstd'), id }
}

const largePayload = (): string => randomBytes(11 * 1024 * 1024).toString('base64')

const observeThenResume = async (
  persistence: SessionPersistence,
  id: SessionId,
  between: () => Promise<void> = async () => {},
): Promise<void> => {
  const observer = await persistence.open(id, 'read')
  await observer.close()
  await between()
  const writer = await persistence.open(id, 'write')
  expect((await writer.read()).events).toHaveLength(2)
  await writer.close()
}

describe('cold log memo', () => {
  it('parses a small log once across the observe then resume handoff', async () => {
    const session = await storedSession('small')
    const persistence = await backend(session.root)
    readFiles.length = 0

    await observeThenResume(persistence, session.id)

    expect(readFiles.filter(path => path === session.path)).toHaveLength(1)
  })

  it('parses a large log once across the observe then resume handoff', async () => {
    const session = await storedSession(largePayload())
    const persistence = await backend(session.root)
    readFiles.length = 0

    await observeThenResume(persistence, session.id)

    expect(readFiles.filter(path => path === session.path)).toHaveLength(1)
  })

  it('drops a large log five seconds after storing it even when read in between', async () => {
    const session = await storedSession(largePayload())
    const persistence = await backend(session.root)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    readFiles.length = 0

    await observeThenResume(persistence, session.id, async () => {
      vi.advanceTimersByTime(3_000)
      await (await persistence.open(session.id, 'read')).close()
      vi.advanceTimersByTime(2_000)
    })

    expect(readFiles.filter(path => path === session.path)).toHaveLength(2)
  })

  it('drops a memoized log once its time to live has passed', async () => {
    const session = await storedSession('small')
    const persistence = await backend(session.root)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    readFiles.length = 0

    await observeThenResume(persistence, session.id, async () => {
      vi.advanceTimersByTime(30_000)
    })

    expect(readFiles.filter(path => path === session.path)).toHaveLength(2)
  })
})
