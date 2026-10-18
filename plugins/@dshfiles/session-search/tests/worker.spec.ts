import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionSearchEngine } from '../src/engine.js'
import { SearchWorkerClient } from '../src/worker-client.js'
import { appendSessionLogEvent, writeSessionLog } from './session-log-fixture.js'

let home: string
let client: SearchWorkerClient | undefined
let fiber: Awaited<ReturnType<Context['plugin']>> | undefined

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'session-search-worker-'))
})
afterEach(async () => {
  await fiber?.dispose()
  fiber = undefined
  await client?.close()
  client = undefined
  rmSync(home, { recursive: true, force: true })
})

const boot = async (): Promise<Context> => {
  const root = join(home, 'sessions')
  const first = 'session-11111111-0000-4000-8000-000000000000'
  const second = 'session-22222222-0000-4000-8000-000000000000'
  await writeSessionLog({ directory: join(root, 'project', first), exchanges: 3, sessionId: first })
  await writeSessionLog({ directory: join(root, 'project', second), exchanges: 3, sessionId: second })
  client = new SearchWorkerClient({ indexPath: join(home, 'index.sqlite') })
  const context = new Context()
  context.provide('sessions', { list: () => [], get: () => undefined })
  context.provide('sessionPersistence', {
    list: async () => [],
    open: async () => {
      throw new Error('the owned backend must not read logs through the persistence service')
    },
  })
  fiber = await context.plugin(SessionSearchEngine, { client })
  await client.startIngest(root)
  return context
}

const waitForIndex = async (expected: number): Promise<void> => {
  const deadline = Date.now() + 20_000
  for (;;) {
    const health = await client?.health()
    if (health !== undefined && health.sessions >= expected) return
    if (Date.now() > deadline)
      throw new Error(
        `the worker indexed ${String(health?.sessions ?? 0)} of ${String(expected)} sessions in time (${String(health?.lastError ?? 'no error')})`,
      )
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

const waitFor = async (condition: () => Promise<boolean>, label: string): Promise<void> => {
  const deadline = Date.now() + 20_000
  for (;;) {
    if (await condition()) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

describe('owned search backend over the real worker', () => {
  it('indexes the corpus, answers sessionQuery, and pages with a cursor', async () => {
    const context = await boot()
    await waitForIndex(2)
    const health = await client?.health()
    expect(health?.sessions).toBe(2)
    expect(health?.documents).toBeGreaterThan(0)

    const page = await context.sessionQuery.searchSessions({ query: 'retry storm', limit: 1 })
    expect(page.items.length).toBe(1)
    expect(page.items[0]?.header.id).toMatch(/^session-/u)
    expect(page.items[0]?.persisted).toBe(true)
    expect(page.items[0]?.live).toBe(false)
    expect(page.items[0]?.bestMatch.snippet).toContain('retry')
    expect(page.nextCursor).toBeDefined()

    const next = await context.sessionQuery.searchSessions({ query: 'retry storm', limit: 1, cursor: page.nextCursor })
    expect(next.items.length).toBe(1)
    expect(next.items[0]?.header.id).not.toBe(page.items[0]?.header.id)

    // A cursor belongs to one normalized request; a different query must not continue it.
    await expect(context.sessionQuery.searchSessions({ query: 'exchange', limit: 1, cursor: page.nextCursor })).rejects.toMatchObject({
      code: 'SESSION_QUERY_STALE_CURSOR',
    })
  })

  it('searches one session and reports an unknown target', async () => {
    const context = await boot()
    await waitForIndex(2)
    const sessionId = 'session-11111111-0000-4000-8000-000000000000'
    const page = await context.sessionQuery.searchEvents({ sessionId, query: 'retry storm', limit: 5 })
    expect(page.session.id).toBe(sessionId)
    expect(page.items.length).toBeGreaterThan(0)
    expect(page.items.every(item => item.sessionId === sessionId)).toBe(true)
    await expect(context.sessionQuery.searchEvents({ sessionId: 'session-99999999-0000-4000-8000-000000000000', query: 'x', limit: 5 })).rejects.toMatchObject({
      code: 'SESSION_QUERY_SESSION_NOT_FOUND',
    })
  })

  it('refuses filters it does not implement instead of returning wrong results', async () => {
    const context = await boot()
    await waitForIndex(2)
    await expect(
      context.sessionQuery.searchSessions({ query: 'retry', limit: 5, sessionFilters: [{ kind: 'cwd', values: ['/dev/dshfiles'] }] }),
    ).rejects.toMatchObject({ code: 'SESSION_QUERY_INVALID_FILTER' })
  })

  it('indexes an appended frame after a commit nudge', async () => {
    const context = await boot()
    await waitForIndex(2)
    const sessionId = 'session-22222222-0000-4000-8000-000000000000'
    const logPath = join(home, 'sessions', 'project', sessionId, 'session.v4.jsonl.zstd')
    expect((await context.sessionQuery.searchSessions({ query: 'afterthought', limit: 5 })).items).toHaveLength(0)
    await appendSessionLogEvent(logPath, {
      type: 'user/message',
      seq: 8,
      time: 1_700_000_000_900,
      data: { id: 'msg-9', role: 'user', content: [{ type: 'text', text: 'the afterthought marker' }], source: { kind: 'user' } },
    })
    await client?.nudge()
    await waitFor(
      async () => (await context.sessionQuery.searchSessions({ query: 'afterthought', limit: 5 })).items.length > 0,
      'the appended frame to be indexed',
    )
  })

  it('restricts a search to the requested session ids', async () => {
    const context = await boot()
    await waitForIndex(2)
    const first = SessionId('session-11111111-0000-4000-8000-000000000000')
    const second = SessionId('session-22222222-0000-4000-8000-000000000000')
    const both = await context.sessionQuery.searchSessions({ query: 'retry storm', limit: 5, sessionFilters: [{ kind: 'id', values: [first, second] }] })
    expect(both.items).toHaveLength(2)
    const one = await context.sessionQuery.searchSessions({ query: 'retry storm', limit: 5, sessionFilters: [{ kind: 'id', values: [first] }] })
    expect(one.items.map(item => item.header.id)).toEqual([first])
    const none = await context.sessionQuery.searchSessions({ query: 'retry storm', limit: 5, sessionFilters: [{ kind: 'id', values: [] }] })
    expect(none.items).toHaveLength(0)
  })
})
