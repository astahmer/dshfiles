import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import { resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
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
const recoveryFixture = async (readLog: () => Promise<readonly SessionEvent[]>, sizeBytes = 2_048) => {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  const list = new ApiSessionList(ctx, 8)
  const session = ctx.sessions.prepare(SessionId('cold-recover'), { meta: { createdAt: 100, cwd: resolve('cold-list-recover-fixture') } })
  const records: SessionRecord[] = [{ header: session.header, live: false, persisted: true }]
  const logReads: string[] = []
  // SAFETY: list() reads listSessions and, on a checkpoint miss, readSession from the query service.
  ctx.provide('sessionQuery', {
    listSessions: async () => records,
    readSession: async (sessionId: string) => {
      logReads.push(sessionId)
      return { session: session.header, inheritedEventCount: 0, events: [...(await readLog())] }
    },
  } as never)
  // SAFETY: the cold path calls only cachedSnapshot and cachedPredecessorTitle, and neither has this Session's row.
  ctx.provide('sessionProjectionCache', {
    cachedSnapshot: () => undefined,
    cachedPredecessorTitle: () => undefined,
  } as never)
  // SAFETY: recovery reads only the stored log's size before folding it.
  ctx.provide('sessionPersistence', { stat: async () => ({ header: session.header, sizeBytes }) } as never)
  const pushed: SessionSummary[] = []
  ctx.on('api-session/added', summary => {
    pushed.push(summary)
  })
  return { ctx, list, logReads, session, pushed }
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
  const { list, logReads, pushed } = await recoveryFixture(async () => [], 300_000)
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
