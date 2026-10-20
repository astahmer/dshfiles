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
