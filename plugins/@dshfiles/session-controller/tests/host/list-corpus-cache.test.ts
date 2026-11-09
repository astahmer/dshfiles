import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import { recordSpans } from '@dshfiles/dshx/tracing'
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

it('records bounded corpus cache and invalidation diagnostics', async () => {
  const ctx = await hostContext()
  const record = coldRecord(ctx, 'private-session-id')
  ctx.provide('sessionQuery', { listSessions: async () => [record] } as never)
  const list = new ApiSessionList(ctx, 8)
  using recorder = recordSpans()
  await list.list()
  await list.list()
  ctx.emit('session/created', ctx.sessions.prepare(SessionId('private-session-id'), { meta: { createdAt: 100, cwd: resolve('cold-list-fixture') } }))
  await list.list()
  const spans = recorder.named('session list read')
  expect(spans.map(span => span.attributes['dshx.session-controller.corpus_cache'])).toEqual(['miss', 'hit', 'miss'])
  expect(spans[2]?.attributes).toMatchObject({ 'dshx.session-controller.last_invalidation': 'created', 'dshx.session-controller.created_invalidations': 1 })
  expect(recorder.named('session corpus read')).toHaveLength(2)
  expect(JSON.stringify(spans.map(span => span.attributes))).not.toContain('private-session-id')
})

it('does not cache a corpus read invalidated while it is in flight', async () => {
  const ctx = await hostContext()
  const oldRecord = coldRecord(ctx, 'old-corpus')
  const newRecord = coldRecord(ctx, 'new-corpus')
  const pending: Array<(records: readonly SessionRecord[]) => void> = []
  ctx.provide('sessionQuery', {
    listSessions: () => new Promise<readonly SessionRecord[]>(resolve => pending.push(resolve)),
  } as never)
  const list = new ApiSessionList(ctx, 8)
  using recorder = recordSpans()
  const first = list.list()
  ctx.emit('session/disposed', ctx.sessions.prepare(SessionId('old-corpus'), { meta: { createdAt: 100, cwd: resolve('cold-list-fixture') } }))
  const second = list.list()
  expect(pending).toHaveLength(2)
  pending[1]?.([newRecord])
  expect((await second).map(item => item.sessionId)).toEqual(['new-corpus'])
  pending[0]?.([oldRecord])
  await first
  expect((await list.list()).map(item => item.sessionId)).toEqual(['new-corpus'])
  expect(recorder.named('session corpus read').map(span => span.attributes['dshx.session-controller.current'])).toEqual([true, false])
  expect(recorder.named('session list read').some(span => span.attributes['dshx.session-controller.last_invalidation'] === 'disposed')).toBe(true)
})

it('retries a failed corpus read without retaining sensitive diagnostics', async () => {
  const ctx = await hostContext()
  const record = coldRecord(ctx, 'sensitive-session')
  let reads = 0
  ctx.provide('sessionQuery', {
    listSessions: async () => {
      reads += 1
      if (reads === 1) throw new Error('sensitive failure detail')
      return [record]
    },
  } as never)
  const list = new ApiSessionList(ctx, 8)
  using recorder = recordSpans()
  await expect(list.list()).rejects.toThrow('sensitive failure detail')
  expect((await list.list()).map(item => item.sessionId)).toEqual(['sensitive-session'])
  expect(reads).toBe(2)
  const spans = [...recorder.named('session corpus read'), ...recorder.named('session list read')]
  expect(JSON.stringify(spans.map(span => span.attributes))).not.toContain('sensitive')
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
  using recorder = recordSpans()

  await expect(list.list({}, AbortSignal.timeout(10))).rejects.toThrow()
  const shared = list.list()
  settle([record])
  await shared
  await new Promise(resolve => setImmediate(resolve))
  const items = await list.list()

  expect(recorder.named('session corpus read')).toHaveLength(1)
  expect(recorder.named('session list read').map(span => span.attributes['dshx.session-controller.corpus_cache'])).toContain('shared')
  expect(reads).toBe(1)
  expect(items.map(item => item.sessionId)).toEqual(['cold-abort'])
})
