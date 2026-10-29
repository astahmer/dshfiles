import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, type SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import SqliteSessionQueryEngine from '@deepseek-ai/dsh-session-query-sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { sessionContentHits } from './session-content.ts'
import { createThread } from './testing/session-fixture.ts'
import { createThreadFinder, ThreadFinderError, type ThreadFinderRecord } from './thread-finder.ts'

let root: string
let counter = 0
let stopEngine: (() => Promise<void>) | undefined
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'memory-finder-'))
})
afterEach(async () => {
  await stopEngine?.()
  stopEngine = undefined
  rmSync(root, { recursive: true, force: true })
})

type Stored = { readonly header: SessionHeader; readonly events: readonly SessionEvent[] }

const stored = (id: string, title: string, body: string, cwd = '/dev/dshfiles'): Stored => {
  const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1_700_000_000_000, cwd, isSeeded: false }
  const thread = createThread({ id, cwd })
  thread.exchange(body, `Noted: ${body}`)
  thread.title(title)
  return { header, events: [...thread.log().events] }
}

type StoredRead = { readonly eventState: 'shared-frozen'; readonly events: readonly SessionEvent[] }

type StoredHandle = {
  readonly id: SessionId
  readonly header: SessionHeader
  readonly inheritedEventCount: number
  readonly read: () => Promise<StoredRead>
  readonly close: () => Promise<void>
}

/** The persistence surface the installed engine observes: its corpus listing and one cold session read. */
type ObservedPersistence = {
  readonly list: (options?: { readonly signal?: AbortSignal }) => Promise<readonly { readonly header: SessionHeader; readonly revision: string }[]>
  readonly open: (sessionId: string) => Promise<StoredHandle>
}

/** A persistence backend whose `list()` revisions are scripted per call, so the engine's observation window can be made to move. */
const scriptedPersistence = (session: Stored, revisions: readonly string[]) => {
  const state = { listCalls: 0 }
  return {
    state,
    list: async () => {
      const revision = revisions[state.listCalls] ?? revisions[revisions.length - 1] ?? 'revision-1'
      state.listCalls += 1
      return [{ header: structuredClone(session.header), revision }]
    },
    open: async () => ({
      id: session.header.id,
      header: structuredClone(session.header),
      inheritedEventCount: 0,
      read: async () => ({ eventState: 'shared-frozen' as const, events: structuredClone([...session.events]) }),
      close: async () => {},
    }),
  }
}

const boot = async (persistence: ObservedPersistence) => {
  const ctx = new Context()
  ctx.provide('sessions', { list: () => [], get: () => undefined })
  ctx.provide('sessionPersistence', persistence)
  counter += 1
  const fiber = await ctx.plugin(SqliteSessionQueryEngine, { path: join(root, `index-${counter}.sqlite`), openAt: 'first-search' })
  stopEngine = async () => {
    await fiber.dispose()
  }
  return ctx
}

const record = (session: Stored, project = '/dev/dshfiles'): ThreadFinderRecord => ({
  sessionId: session.header.id,
  title: 'Retry storm plan',
  createdAt: session.header.createdAt,
  updatedAt: session.header.createdAt + 1_000,
  cwd: session.header.cwd ?? null,
  project,
  live: false,
  persisted: true,
  parentSessionId: null,
})

describe('thread finder against the installed session-query backend', () => {
  it('returns ranked Session hits from a stable corpus', async () => {
    const session = stored('session-11111111-0000-4000-8000-000000000000', 'Retry storm plan', 'We must cap the retry storm at four attempts.')
    const persistence = scriptedPersistence(session, ['revision-1'])
    const ctx = await boot(persistence)
    const page = await ctx.sessionQuery.searchSessions({ query: 'retry storm', limit: 5 })
    expect(page.items.map(hit => hit.header.id)).toEqual([session.header.id])
    expect(page.items[0]?.bestMatch.snippet).toContain('retry storm')
  })

  it('gives up after exactly two unstable observations, as the installed backend documents', async () => {
    const session = stored('session-22222222-0000-4000-8000-000000000000', 'Retry storm plan', 'We must cap the retry storm at four attempts.')
    const persistence = scriptedPersistence(session, ['revision-1', 'revision-2', 'revision-3', 'revision-4'])
    const ctx = await boot(persistence)
    await expect(ctx.sessionQuery.searchSessions({ query: 'retry storm', limit: 5 })).rejects.toMatchObject({
      code: 'SESSION_QUERY_PERSISTENCE_FAILED',
    })
    expect(persistence.state.listCalls).toBe(4)
  })

  it('recovers through the finder retry once a later observation stabilizes', async () => {
    const session = stored('session-33333333-0000-4000-8000-000000000000', 'Retry storm plan', 'We must cap the retry storm at four attempts.')
    const persistence = scriptedPersistence(session, ['revision-1', 'revision-2', 'revision-3', 'revision-4', 'revision-5'])
    const ctx = await boot(persistence)
    const finder = createThreadFinder({
      listSessions: async () => [record(session)],
      searchContent: async request => sessionContentHits(await ctx.sessionQuery.searchSessions({ query: request.query, limit: request.limit })),
      searchMemory: async () => [],
      readDigest: async () => null,
      retry: { attempts: 3, delaysMs: [0, 0, 0], sleep: async () => {} },
    })
    const page = await finder.find({ query: 'retry storm', projects: [], ownProject: '/dev/dshfiles', limit: 5 })
    expect(page.degraded).toEqual([])
    expect(page.diagnostics.attempts).toBe(2)
    expect(page.hits.map(hit => hit.sessionId)).toEqual([session.header.id])
    expect(page.hits[0]?.sources).toContain('session-content')
  })

  it('degrades with a labeled page when the corpus never stabilizes, and never reports a false empty', async () => {
    const session = stored('session-44444444-0000-4000-8000-000000000000', 'Retry storm plan', 'We must cap the retry storm at four attempts.')
    const revisions = Array.from({ length: 64 }, (_, index) => `revision-${index}`)
    const unstable = scriptedPersistence(session, revisions)
    const ctx = await boot(unstable)
    const finder = createThreadFinder({
      listSessions: async () => [record(session)],
      searchContent: async request => sessionContentHits(await ctx.sessionQuery.searchSessions({ query: request.query, limit: request.limit })),
      searchMemory: async () => [],
      readDigest: async () => null,
      retry: { attempts: 3, delaysMs: [0, 0, 0], sleep: async () => {} },
    })
    const degraded = await finder.find({ query: 'retry storm', projects: [], ownProject: '/dev/dshfiles', limit: 5 })
    expect(degraded.degraded).toHaveLength(1)
    expect(degraded.degraded[0]?.code).toBe('SESSION_QUERY_PERSISTENCE_FAILED')
    expect(degraded.diagnostics.incomplete).toBe(true)
    expect(degraded.hits.map(hit => hit.sessionId)).toEqual([session.header.id])
    expect(unstable.state.listCalls).toBe(12)

    const other = createThreadFinder({
      listSessions: async () => [record(session)],
      searchContent: async request => sessionContentHits(await ctx.sessionQuery.searchSessions({ query: request.query, limit: request.limit })),
      searchMemory: async () => [],
      readDigest: async () => null,
      retry: { attempts: 2, delaysMs: [0, 0], sleep: async () => {} },
    })
    await expect(other.find({ query: 'nothing matches this at all', projects: [], ownProject: '/dev/dshfiles', limit: 5 })).rejects.toBeInstanceOf(
      ThreadFinderError,
    )
  })
})
