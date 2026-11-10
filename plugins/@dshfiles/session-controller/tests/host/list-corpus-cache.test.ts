import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ApiSessionList } from '../../src/native/list.ts'

const contexts = new Set<Context>()
const roots = new Set<string>()

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all([...contexts].map(ctx => ctx.fiber.dispose()))
  contexts.clear()
  await Promise.all([...roots].map(root => rm(root, { recursive: true, force: true })))
  roots.clear()
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

const fixtureSession = (ctx: Context, id: string) =>
  ctx.sessions.prepare(SessionId(id), { meta: { createdAt: 100, cwd: resolve('cold-list-fixture') } })

it('reads the persisted Sessions once for many lists', async () => {
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
})

it('adds a created Session and keeps a disposed one without reading the corpus again', async () => {
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
  const fresh = fixtureSession(ctx, 'fresh')
  // SAFETY: a disposed Session is checked with stat alone.
  ctx.provide('sessionPersistence', { stat: async () => ({ header: fresh.header, revision: 'r1' }) } as never)
  const list = new ApiSessionList(ctx, 8)
  await list.list()

  ctx.emit('session/created', fresh)
  expect((await list.list()).map(item => item.sessionId).sort()).toEqual(['cold-shared', 'fresh'])
  ctx.emit('session/disposed', fresh)
  await new Promise(resolve => setImmediate(resolve))
  expect((await list.list()).map(item => item.sessionId).sort()).toEqual(['cold-shared', 'fresh'])
  expect(reads).toBe(1)
})

const storeFixture = async (ctx: Context) => {
  const root = await mkdtemp(join(tmpdir(), 'list-corpus-store-'))
  roots.add(root)
  const headers = new Map<string, SessionRecord['header']>()
  const statted: string[] = []
  const store = (project: string, id: string): Promise<string | undefined> => {
    headers.set(id, fixtureSession(ctx, id).header)
    return mkdir(join(root, project, id), { recursive: true })
  }
  // SAFETY: the corpus probe reads only the backend root and stat.
  ctx.provide('sessionPersistence', {
    root,
    stat: async (id: string) => {
      statted.push(id)
      const header = headers.get(id)
      return header === undefined ? undefined : { header, revision: 'r1' }
    },
  } as never)
  return { root, headers, statted, store }
}

const listedIds = async (list: ApiSessionList): Promise<string[]> => (await list.list()).map(item => item.sessionId).sort()

it('lists and announces a Session another process stored after the corpus was read', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const ctx = await hostContext()
  const store = await storeFixture(ctx)
  await store.store('project-a', 'cold-first')
  const first = coldRecord(ctx, 'cold-first')
  let reads = 0
  // SAFETY: list() reads only listSessions from the query service.
  ctx.provide('sessionQuery', {
    listSessions: async () => {
      reads += 1
      return [first]
    },
  } as never)
  const announced: string[] = []
  ctx.on('api-session/added', summary => {
    announced.push(summary.sessionId)
  })
  const list = new ApiSessionList(ctx, 8)
  using recorder = recordSpans()
  expect(await listedIds(list)).toEqual(['cold-first'])

  await store.store('project-b', 'written-behind')
  vi.setSystemTime(Date.now() + 2_000)
  expect(await listedIds(list)).toEqual(['cold-first', 'written-behind'])
  expect(announced).toEqual(['written-behind'])
  expect(store.statted).toEqual(['written-behind'])
  expect(reads).toBe(1)
  expect(recorder.named('session corpus revalidate')[0]?.attributes).toMatchObject({
    'dshx.session-controller.changed_projects': 1,
    'dshx.session-controller.added': 1,
  })
})

it('probes the store at most once a second and reads only unknown Session directories', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const ctx = await hostContext()
  const store = await storeFixture(ctx)
  await store.store('project-a', 'cold-first')
  const first = coldRecord(ctx, 'cold-first')
  // SAFETY: list() reads only listSessions from the query service.
  ctx.provide('sessionQuery', { listSessions: async () => [first] } as never)
  const list = new ApiSessionList(ctx, 8)
  using recorder = recordSpans()
  await list.list()

  await list.list()
  expect(recorder.named('session corpus revalidate')).toHaveLength(0)

  const fresh = fixtureSession(ctx, 'fresh')
  ctx.emit('session/created', fresh)
  await store.store('project-a', 'fresh')
  vi.setSystemTime(Date.now() + 2_000)
  expect(await listedIds(list)).toEqual(['cold-first', 'fresh'])
  expect(store.statted).toEqual([])
  expect(recorder.named('session corpus revalidate')).toHaveLength(1)

  vi.setSystemTime(Date.now() + 2_000)
  await list.list()
  expect(recorder.named('session corpus revalidate')[1]?.attributes).toMatchObject({ 'dshx.session-controller.changed_projects': 0 })
})

it('scans a Session directory again until its log is stored', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const ctx = await hostContext()
  const store = await storeFixture(ctx)
  await store.store('project-a', 'cold-first')
  const first = coldRecord(ctx, 'cold-first')
  // SAFETY: list() reads only listSessions from the query service.
  ctx.provide('sessionQuery', { listSessions: async () => [first] } as never)
  const list = new ApiSessionList(ctx, 8)
  await list.list()

  await mkdir(join(store.root, 'project-b', 'half-written'), { recursive: true })
  vi.setSystemTime(Date.now() + 2_000)
  expect(await listedIds(list)).toEqual(['cold-first'])

  store.headers.set('half-written', fixtureSession(ctx, 'half-written').header)
  vi.setSystemTime(Date.now() + 2_000)
  expect(await listedIds(list)).toEqual(['cold-first', 'half-written'])
  expect(store.statted).toEqual(['half-written', 'half-written'])
})

it('drops a disposed Session persistence never stored', async () => {
  const ctx = await hostContext()
  const record = coldRecord(ctx, 'cold-shared')
  ctx.provide('sessionQuery', { listSessions: async () => [record] } as never)
  // SAFETY: a disposed Session is checked with stat alone.
  ctx.provide('sessionPersistence', { stat: async () => undefined } as never)
  const list = new ApiSessionList(ctx, 8)
  await list.list()

  const unstored = fixtureSession(ctx, 'unstored')
  ctx.emit('session/created', unstored)
  ctx.emit('session/disposed', unstored)
  await expect.poll(async () => (await list.list()).map(item => item.sessionId)).toEqual(['cold-shared'])
})

it('records bounded corpus cache and invalidation diagnostics', async () => {
  const ctx = await hostContext()
  const record = coldRecord(ctx, 'private-session-id')
  ctx.provide('sessionQuery', { listSessions: async () => [record] } as never)
  const list = new ApiSessionList(ctx, 8)
  using recorder = recordSpans()
  await list.list()
  await list.list()
  ctx.emit('session/created', fixtureSession(ctx, 'private-session-id'))
  await list.list()
  const spans = recorder.named('session list read')
  expect(spans.map(span => span.attributes['dshx.session-controller.corpus_cache'])).toEqual(['miss', 'hit', 'hit'])
  expect(spans[2]?.attributes).toMatchObject({ 'dshx.session-controller.last_invalidation': 'created', 'dshx.session-controller.created_invalidations': 1 })
  expect(recorder.named('session corpus read')).toHaveLength(1)
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
