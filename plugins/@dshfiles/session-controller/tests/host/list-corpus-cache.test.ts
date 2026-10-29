import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
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

const hostContext = async (): Promise<Context> => {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  // SAFETY: the cold path calls only cachedSnapshot and cachedPredecessorTitle.
  ctx.provide('sessionProjectionCache', {
    cachedSnapshot: () => ({ asOfSeq: -1, values: { sessionListMetadata: { blank: false, lastPromptAt: 200 } } }),
    cachedPredecessorTitle: () => undefined,
  } as never)
  return ctx
}

const coldRecord = (ctx: Context, id: string): SessionRecord => {
  const session = ctx.sessions.prepare(SessionId(id), { meta: { createdAt: 100, cwd: resolve('cold-list-fixture') } })
  return { header: session.header, live: false, persisted: true }
}

it('reads the persisted Sessions once for many lists, until a Session is created', async () => {
  const ctx = await hostContext()
  const record = coldRecord(ctx, 'cold-shared')
  let reads = 0
  // SAFETY: list() reads only listSessions from the query service.
  ctx.provide('sessionQuery', {
    listSessions: async () => {
      reads += 1
      return [record]
    },
  } as never)
  const list = new ApiSessionList(ctx, 8)

  await list.list()
  await list.list()
  await list.list()
  expect(reads).toBe(1)

  ctx.emit('session/created', ctx.sessions.prepare(SessionId('cold-shared'), { meta: { createdAt: 100, cwd: resolve('cold-list-fixture') } }))
  await list.list()
  expect(reads).toBe(2)
})

it('stops waiting for a corpus read at the caller budget without repeating the read', async () => {
  const ctx = await hostContext()
  const record = coldRecord(ctx, 'cold-abort')
  let reads = 0
  let settle: (records: readonly SessionRecord[]) => void = () => {}
  // SAFETY: list() reads only listSessions from the query service.
  ctx.provide('sessionQuery', {
    listSessions: async () => {
      reads += 1
      return new Promise<readonly SessionRecord[]>(resolve => {
        settle = resolve
      })
    },
  } as never)
  const list = new ApiSessionList(ctx, 8)

  await expect(list.list({}, AbortSignal.timeout(10))).rejects.toThrow()
  settle([record])
  await new Promise(resolve => setImmediate(resolve))
  const items = await list.list()

  expect(reads).toBe(1)
  expect(items.map(item => item.sessionId)).toEqual(['cold-abort'])
})
