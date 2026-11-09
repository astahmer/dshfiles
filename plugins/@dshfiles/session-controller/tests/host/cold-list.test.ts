import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import { resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { RecoveredListMetadata } from '../../src/native/list-metadata-store.ts'
import { ApiSessionList } from '../../src/native/list.ts'
import type { SessionSummary } from '../../src/native/types.ts'

const contexts = new Set<Context>()

afterEach(async () => {
  await Promise.all([...contexts].map(ctx => ctx.fiber.dispose()))
  contexts.clear()
})

it('reads a cold Session projection once per list until that Session attaches', async () => {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  const list = new ApiSessionList(ctx, 8)
  const session = ctx.sessions.prepare(SessionId('cold-one'), { meta: { createdAt: 100, cwd: resolve('cold-list-fixture') } })
  const records: SessionRecord[] = [{ header: session.header, live: false, persisted: true }]
  const reads: string[] = []
  // SAFETY: list() reads only listSessions from the query service and these two cache methods.
  ctx.provide('sessionQuery', { listSessions: async () => records } as never)
  // SAFETY: as above, the cold path calls only cachedSnapshot and cachedPredecessorTitle.
  ctx.provide('sessionProjectionCache', {
    cachedSnapshot: (header: SessionRecord['header']) => {
      reads.push(header.id)
      return { asOfSeq: -1, values: { sessionListMetadata: { blank: false, lastPromptAt: 200 } } }
    },
    cachedPredecessorTitle: () => undefined,
  } as never)

  const first = await list.list()
  const second = await list.list()
  expect(second).toEqual(first)
  expect(reads).toEqual(['cold-one'])

  ctx.emit('session/created', session)
  await list.list()
  expect(reads).toEqual(['cold-one', 'cold-one'])
})

const storedEvent = (event: { readonly seq: number; readonly time: number; readonly type: string; readonly data?: object }): SessionEvent =>
  // SAFETY: the list metadata fold reads only the event type, its time, and the source of a user message.
  ({ data: {}, ...event }) as never

/** A cold Session whose projection checkpoint has no row at all, so its list metadata has to come from its stored log. */
const recoveryFixture = async (
  readLog: () => Promise<readonly SessionEvent[]>,
  { sizeBytes = 2_048, revision = 'r1', stored, rows = 1 }: {
    readonly sizeBytes?: number
    readonly revision?: string
    readonly stored?: Map<string, unknown>
    readonly rows?: number
  } = {},
) => {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  const list = new ApiSessionList(ctx, 8)
  const sessions = Array.from({ length: rows }, (_, index) => ctx.sessions.prepare(
    SessionId(index === 0 ? 'cold-recover' : `cold-recover-${index}`),
    { meta: { createdAt: 100 - index, cwd: resolve('cold-list-recover-fixture') } },
  ))
  const session = sessions[0]
  if (session === undefined) throw new Error('the fixture prepares at least one Session')
  const records: SessionRecord[] = sessions.map(prepared => ({ header: prepared.header, live: false, persisted: true }))
  const headerOf = (sessionId: string) => sessions.find(prepared => prepared.id === sessionId)?.header ?? session.header
  const logReads: string[] = []
  const persistenceLists: string[] = []
  const persistence = {
    list: async () => {
      persistenceLists.push('list')
      return records.map(record => ({ header: record.header, sizeBytes, revision }))
    },
    stat: async (sessionId: string) => {
      stats.push(sessionId)
      return { header: headerOf(sessionId), sizeBytes, revision }
    },
    open: async (sessionId: string) => ({
      header: headerOf(sessionId),
      inheritedEventCount: 0,
      read: async () => {
        logReads.push(sessionId)
        return { events: [...(await readLog())], eventState: 'owned' }
      },
      close: async () => undefined,
    }),
  }
  // SAFETY: list() reads listSessions; readSession lists the persisted corpus before its read, as the core engine does.
  ctx.provide('sessionQuery', {
    listSessions: async () => records,
    readSession: async (sessionId: string) => {
      await persistence.list()
      const handle = await persistence.open(sessionId)
      return { session: handle.header, inheritedEventCount: 0, events: (await handle.read()).events }
    },
  } as never)
  // SAFETY: the cold path calls only cachedSnapshot and cachedPredecessorTitle, and neither has this Session's row.
  ctx.provide('sessionProjectionCache', {
    cachedSnapshot: () => undefined,
    cachedPredecessorTitle: () => undefined,
  } as never)
  const stats: string[] = []
  // SAFETY: recovery stats a stored log for its size and revision, then opens and reads that one log.
  ctx.provide('sessionPersistence', persistence as never)
  if (stored !== undefined) {
    // SAFETY: the list metadata store opens one domain and reads and writes one snapshot key of one table.
    ctx.provide('storageDomain', {
      open: async () => ({
        table: () => ({
          get: (key: string) => stored.get(key),
          put: async (key: string, value: Readonly<Record<string, RecoveredListMetadata>>) => { stored.set(key, structuredClone(value)) },
        }),
        close: async () => undefined,
      }),
    } as never)
  }
  const pushed: SessionSummary[] = []
  ctx.on('api-session/added', summary => {
    pushed.push(summary)
  })
  return { ctx, list, logReads, stats, session, pushed, persistenceLists }
}

it('pushes a checkpoint-less cold Session with no turn as blank instead of an untitled draft', async () => {
  const { list, logReads, pushed } = await recoveryFixture(async () => [
    storedEvent({ seq: 0, time: 110, type: 'permission/preset' }),
    storedEvent({ seq: 1, time: 120, type: 'session/title', data: { title: 'tupu improvements', messageSeqs: [], source: { kind: 'user' } } }),
  ])
  expect((await list.list())[0]?.blank).toBe(false)
  await expect.poll(() => pushed).toMatchObject([{ sessionId: 'cold-recover', blank: true, updatedAt: 100 }])
  expect((await list.list())[0]?.blank).toBe(true)
  expect(logReads).toEqual(['cold-recover'])
})

it('lists without waiting for a stored log that is still being read', async () => {
  let release = (): void => undefined
  const blocked = new Promise<readonly SessionEvent[]>(resolveRead => {
    release = () => {
      resolveRead([])
    }
  })
  const { list, pushed } = await recoveryFixture(() => blocked)
  expect((await list.list()).map(item => item.blank)).toEqual([false])
  release()
  await expect.poll(() => pushed.map(summary => summary.blank)).toEqual([true])
})

it('keeps a cold Session visible once its stored log proves a turn, dated by its last prompt', async () => {
  const { list, pushed } = await recoveryFixture(async () => [
    storedEvent({ seq: 0, time: 200, type: 'user/message', data: { source: { kind: 'user' } } }),
    storedEvent({ seq: 1, time: 210, type: 'turn/start' }),
  ])
  await list.list()
  await expect.poll(() => pushed).toMatchObject([{ blank: false, updatedAt: 200 }])
})

it('leaves a log too large to be an abandoned draft unread and visible', async () => {
  const { list, logReads, pushed } = await recoveryFixture(async () => [], { sizeBytes: 300_000 })
  await list.list()
  await new Promise(resolveTick => setTimeout(resolveTick, 20))
  expect((await list.list())[0]?.blank).toBe(false)
  expect(logReads).toEqual([])
  expect(pushed).toEqual([])
})

it('reads the log again once that Session attaches', async () => {
  const { ctx, list, logReads, session, pushed } = await recoveryFixture(async () => [storedEvent({ seq: 0, time: 110, type: 'permission/preset' })])
  await list.list()
  await expect.poll(() => pushed.length).toBe(1)
  await list.list()
  expect(logReads).toEqual(['cold-recover'])

  ctx.emit('session/created', session)
  ctx.emit('session/disposed', session)
  await list.list()
  await expect.poll(() => logReads).toEqual(['cold-recover', 'cold-recover'])
})

const abandonedDraft = async (): Promise<readonly SessionEvent[]> => [storedEvent({ seq: 0, time: 110, type: 'permission/preset' })]

it('serves the stored answer on the next Host start without reading the unchanged log again', async () => {
  const stored = new Map<string, unknown>()
  const first = await recoveryFixture(abandonedDraft, { stored })
  await first.list.list()
  await expect.poll(() => stored.size).toBe(1)
  expect(first.logReads).toEqual(['cold-recover'])

  const next = await recoveryFixture(abandonedDraft, { stored })
  expect((await next.list.list())[0]?.blank).toBe(true)
  await expect.poll(() => next.stats).toEqual(['cold-recover'])
  await new Promise(resolveTick => setTimeout(resolveTick, 20))
  expect(next.logReads).toEqual([])
  expect(next.pushed).toEqual([])
})

it('folds the log again when its persistence revision moved', async () => {
  const stored = new Map<string, unknown>()
  const first = await recoveryFixture(abandonedDraft, { stored })
  await first.list.list()
  await expect.poll(() => stored.size).toBe(1)

  const next = await recoveryFixture(async () => [
    storedEvent({ seq: 0, time: 200, type: 'user/message', data: { source: { kind: 'user' } } }),
    storedEvent({ seq: 1, time: 210, type: 'turn/start' }),
  ], { stored, revision: 'r2' })
  expect((await next.list.list())[0]?.blank).toBe(true)
  await expect.poll(() => next.pushed).toMatchObject([{ blank: false, updatedAt: 200 }])
  expect(next.logReads).toEqual(['cold-recover'])
})

it('does not stat a log a previous Host start already found too large', async () => {
  const stored = new Map<string, unknown>()
  const first = await recoveryFixture(abandonedDraft, { stored, sizeBytes: 300_000 })
  await first.list.list()
  await expect.poll(() => stored.size).toBe(1)

  const next = await recoveryFixture(abandonedDraft, { stored, sizeBytes: 300_000 })
  await next.list.list()
  await new Promise(resolveTick => setTimeout(resolveTick, 20))
  expect(next.stats).toEqual([])
  expect(next.logReads).toEqual([])
})

it('recovers from the logs when the stored answers are malformed', async () => {
  const stored = new Map<string, unknown>([['entries', { 'cold-recover': { createdAt: 'yesterday' } }]])
  const { list, logReads, pushed } = await recoveryFixture(abandonedDraft, { stored })
  await list.list()
  await expect.poll(() => pushed.map(summary => summary.blank)).toEqual([true])
  expect(logReads).toEqual(['cold-recover'])
})

it('folds many checkpoint-less logs without listing the persisted corpus once', async () => {
  const { list, logReads, pushed, persistenceLists } = await recoveryFixture(abandonedDraft, { rows: 12 })
  await list.list()
  await expect.poll(() => pushed.length).toBe(12)
  expect(logReads).toHaveLength(12)
  expect(persistenceLists).toEqual([])
})
