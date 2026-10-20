import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionQueryEngine, type SessionRecord } from '@deepseek-ai/dsh-session-query'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionSearchEngine } from './engine.js'
import { SearchWorkerClient } from './worker-client.js'

afterEach(() => {
  vi.restoreAllMocks()
})

it('lists Sessions once until one is created, disposed, or a listed header changes', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.prepare(SessionId('listed'), { meta: { createdAt: 1, cwd: '/work/a' } })
  let header = session.header
  let lists = 0
  vi.spyOn(SessionQueryEngine.prototype, 'listSessions').mockImplementation(async () => {
    lists += 1
    const record: SessionRecord = { header: structuredClone(header), live: true, persisted: true }
    return [record]
  })
  const engine = new SessionSearchEngine(ctx, { client: new SearchWorkerClient({ indexPath: ':memory:' }) })
  // SAFETY: the listing only compares the Session's id and header; the event body is irrelevant to it.
  const anyEvent = { seq: 1, type: 'session/title', time: 1, data: {} } as never

  await engine.listSessions()
  await engine.listSessions()
  ctx.emit('session/event', session, anyEvent)
  await engine.listSessions()
  expect(lists).toBe(1)

  ctx.emit('session/created', session)
  await engine.listSessions()
  expect(lists).toBe(2)

  header = { ...session.header, cwd: '/work/b' }
  // SAFETY: a moved workspace gives the live Session a new header; the listing reads only `id` and `header`.
  ctx.emit('session/event', { id: session.id, header } as never, anyEvent)
  const moved = await engine.listSessions()
  expect(lists).toBe(3)
  expect(moved[0]?.header.cwd).toBe('/work/b')
})
