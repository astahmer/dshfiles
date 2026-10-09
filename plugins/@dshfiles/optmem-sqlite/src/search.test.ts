import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { StreamIds, type MemoryAccess, type MemoryEngine } from '@dshfiles/optmem-core'

import type { SqliteMemory } from './sqlite-memory.ts'
import { createFakeSummarizer } from './testing/fake-summarizer.ts'
import { createTempDirectory, event, openEngine } from './testing/temp-memory.ts'

const temp = createTempDirectory()
afterAll(() => temp.cleanup())

const alpha = (conversationId: string): MemoryAccess => ({ conversationId, projectId: 'alpha', allowAllProjects: false })

let engine: MemoryEngine
let memory: SqliteMemory

const filler = (conversationId: string, projectId: string | null, count: number) =>
  Array.from({ length: count }, (_unused, index) =>
    event({ conversationId, projectId, role: index % 2 === 0 ? 'user' : 'assistant', text: `routine chatter ${index} about lunch and weather` }),
  )

beforeAll(async () => {
  ;({ engine, memory } = await openEngine({
    path: join(temp.directory, 'search.db'),
    summarizer: createFakeSummarizer(),
    config: { redactLiterals: ['p4ssw0rd-literal'] },
  }))
  await engine.append([
    ...filler('a1', 'alpha', 20),
    event({ conversationId: 'a1', projectId: 'alpha', text: 'The staging database lives on port 54329, remember that.' }),
    event({ conversationId: 'a1', projectId: 'alpha', role: 'tool_call', toolName: 'bash', text: 'rg "parseInvoiceTotals(" src' }),
    event({
      conversationId: 'a1',
      projectId: 'alpha',
      role: 'tool_result',
      toolName: 'bash',
      text: 'src/billing.ts:42: export const parseInvoiceTotals = (rows: Row[]) => rows.reduce(sum, 0)',
    }),
    ...filler('a1', 'alpha', 20),
    event({ conversationId: 'a1', projectId: 'alpha', text: 'Decision: invoices are rounded with bankers rounding (half-even).' }),
    event({ conversationId: 'a1', projectId: 'alpha', text: 'my token is sk-ant-api03-SECRETSECRETSECRET01 and the db pass is p4ssw0rd-literal' }),
  ])
  await engine.append([
    ...filler('a2', 'alpha', 30),
    event({ conversationId: 'a2', projectId: 'alpha', text: 'Bug: invoices rounding drifted by a cent for half-even totals.' }),
    event({ conversationId: 'b1', projectId: 'beta', text: 'beta-only secret plan: launch zeppelin fleet' }),
    event({ conversationId: 'g1', projectId: 'beta', text: 'User prefers tabs over spaces everywhere.', global: true }),
    event({ conversationId: 'a2', projectId: 'alpha', role: 'tool_result', toolName: 'cat', text: `HEAD ${'z'.repeat(40_000)} TAIL` }),
  ])
  await engine.drain()
})

describe('memory_search', () => {
  it('finds an exact keyword with a short snippet and a zoomable address', async () => {
    const [hit] = await engine.search({ query: '54329', scope: 'project', access: alpha('a1') })
    expect(hit).toMatchObject({ conversationId: 'a1', stream: 'project:alpha', pos: 20, address: '20+1' })
    expect(hit?.snippet).toContain('[54329]')
    expect(hit?.snippet.length).toBeLessThan(200)
    expect(hit?.viewAddress).toBe('20+1')
    const zoomed = await engine.zoom({ stream: StreamIds.project('alpha'), address: hit?.address ?? '', access: alpha('a1') })
    expect(zoomed.kind === 'event' && zoomed.text).toContain('port 54329')
  })

  it('finds a code snippet with punctuation', async () => {
    const hits = await engine.search({ query: 'parseInvoiceTotals(', scope: 'conversation', access: alpha('a1') })
    expect(hits.map(hit => hit.role).sort()).toEqual(['tool_call', 'tool_result'])
    const [exact] = await engine.search({ query: 'export const parseInvoiceTotals', scope: 'conversation', access: alpha('a1') })
    expect(exact?.role).toBe('tool_result')
  })

  it('finds an obscure one-off fact and its surrounding context', async () => {
    const [hit] = await engine.search({ query: 'bankers rounding', scope: 'project', access: alpha('a2') })
    expect(hit?.conversationId).toBe('a1')
    const around = await engine.context({ stream: StreamIds.project('alpha'), eventId: hit?.eventId, before: 2, after: 1, access: alpha('a2') })
    expect(around.entries.map(entry => entry.pos)).toEqual([(hit?.pos ?? 0) - 2, (hit?.pos ?? 0) - 1, hit?.pos, (hit?.pos ?? 0) + 1])
    expect(around.entries[2]?.text).toContain('bankers rounding')
  })

  it('relates events from distant conversations of the same project', async () => {
    const hits = await engine.search({ query: 'half-even', scope: 'project', access: alpha('a2') })
    expect(new Set(hits.map(hit => hit.conversationId))).toEqual(new Set(['a1', 'a2']))
  })
})

describe('scopes', () => {
  it('shares a project across conversations but hides other projects', async () => {
    expect(await engine.search({ query: 'zeppelin', scope: 'project', access: alpha('a1') })).toEqual([])
    await expect(engine.zoom({ stream: StreamIds.conversation('b1'), address: '0+1', access: alpha('a1') })).rejects.toMatchObject({ code: 'scope-denied' })
    const sibling = await engine.zoom({ stream: StreamIds.conversation('a2'), address: '0+1', access: alpha('a1') })
    expect(sibling.kind).toBe('event')
  })

  it('reads global memory only from explicitly global events', async () => {
    const globalHits = await engine.search({ query: 'tabs', scope: 'global', access: alpha('a1') })
    expect(globalHits.map(hit => hit.stream)).toEqual(['global'])
    expect(await engine.search({ query: 'zeppelin', scope: 'global', access: alpha('a1') })).toEqual([])
    expect(await memory.store.streamLength(StreamIds.global)).toBe(1)
  })

  it('searches all projects only when allowed', async () => {
    await expect(engine.search({ query: 'zeppelin', scope: 'all-projects', access: alpha('a1') })).rejects.toMatchObject({ code: 'scope-denied' })
    const hits = await engine.search({ query: 'zeppelin', scope: 'all-projects', access: { ...alpha('a1'), allowAllProjects: true } })
    expect(hits.map(hit => hit.stream)).toEqual(['project:beta'])
  })
})

describe('ingestion safety', () => {
  it('redacts secrets before they reach the events, the tree or the index', async () => {
    const rows = memory.database.prepare("SELECT text FROM events WHERE text LIKE '%REDACTED%'").all()
    expect(rows.map(row => row['text'])).toEqual(['my token is [REDACTED:api-key] and the db pass is [REDACTED:secret]'])
    const leaked = memory.database.prepare("SELECT COUNT(*) AS count FROM nodes WHERE text LIKE '%SECRETSECRET%' OR text LIKE '%p4ssw0rd%'").get()
    expect(leaked?.['count']).toBe(0)
    expect(await engine.search({ query: 'SECRETSECRETSECRET01', scope: 'project', access: alpha('a1') })).toEqual([])
  })

  it('caps tool results with an explicit truncation marker', async () => {
    const [hit] = await engine.search({ query: 'TAIL', scope: 'project', access: alpha('a2') })
    const zoomed = await engine.zoom({ stream: StreamIds.project('alpha'), address: hit?.address ?? '', access: alpha('a2') })
    expect(zoomed.kind === 'event' && zoomed.truncated).toBe(true)
    const full = memory.database.prepare('SELECT text, bytes FROM events WHERE id = ?').get(hit?.eventId ?? 0)
    expect(full?.['bytes']).toBeLessThanOrEqual(16_384)
    expect(String(full?.['text'])).toMatch(/^HEAD z+\n…\[truncated \d+ bytes\]…\nz+ TAIL$/)
  })

  it('keeps appending and snapshotting when the search index is broken', async () => {
    const path = join(temp.directory, 'broken-fts.db')
    const broken = await openEngine({ path, summarizer: createFakeSummarizer() })
    broken.memory.database.exec('DROP TABLE events_fts')
    const appended = await broken.engine.append([event({ conversationId: 'c9', text: 'still captured' })])
    expect(appended.inserted).toBe(1)
    await broken.engine.drain()
    const status = await broken.engine.status()
    expect(status.search?.error).toMatch(/events_fts/)
    expect((await broken.engine.snapshot({ stream: StreamIds.conversation('c9') })).view).toBe('0+1| user: still captured\n')
    broken.memory.close()
  })
})
