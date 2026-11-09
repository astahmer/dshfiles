import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import { resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ApiSessionList } from '../../src/native/list.ts'

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

/** A cold Session whose projection checkpoint has no row at all, so the summary has to read its stored log. */
const recoveryFixture = async (events: readonly SessionEvent[]) => {
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
      return { session: session.header, inheritedEventCount: 0, events: [...events] }
    },
  } as never)
  // SAFETY: the cold path calls only cachedSnapshot and cachedPredecessorTitle, and neither has this Session's row.
  ctx.provide('sessionProjectionCache', {
    cachedSnapshot: () => undefined,
    cachedPredecessorTitle: () => undefined,
  } as never)
  return { ctx, list, logReads, session }
}

it('treats a checkpoint-less cold Session with no turn as blank, not as an untitled draft', async () => {
  const { list, logReads } = await recoveryFixture([
    storedEvent({ seq: 0, time: 110, type: 'permission/preset' }),
    storedEvent({ seq: 1, time: 120, type: 'session/title', data: { title: 'tupu improvements', messageSeqs: [], source: { kind: 'user' } } }),
    storedEvent({ seq: 2, time: 130, type: 'model/selection', data: { provider: 'opencode-go-alex', model: 'deepseek-v4.1-flash' } }),
  ])
  const items = await list.list()
  expect(items[0]?.blank).toBe(true)
  expect(items[0]?.updatedAt).toBe(100)
  expect(logReads).toEqual(['cold-recover'])
})

it('keeps a cold Session visible once its stored log proves a turn started', async () => {
  const { list } = await recoveryFixture([
    storedEvent({ seq: 0, time: 200, type: 'user/message', data: { source: { kind: 'user' } } }),
    storedEvent({ seq: 1, time: 210, type: 'turn/start' }),
  ])
  const items = await list.list()
  expect(items[0]?.blank).toBe(false)
  expect(items[0]?.updatedAt).toBe(200)
})

it('reads a missing checkpoint log once, and again once that Session attaches', async () => {
  const { ctx, list, logReads, session } = await recoveryFixture([storedEvent({ seq: 0, time: 110, type: 'permission/preset' })])
  await list.list()
  await list.list()
  expect(logReads).toEqual(['cold-recover'])

  ctx.emit('session/created', session)
  await list.list()
  expect(logReads).toEqual(['cold-recover', 'cold-recover'])
})
