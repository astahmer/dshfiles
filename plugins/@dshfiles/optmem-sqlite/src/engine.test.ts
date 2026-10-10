import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { StreamIds, TreeMath, Utf8, ViewMath, type MemoryAccess } from '@dshfiles/optmem-core'

import { openSqliteMemory } from './sqlite-memory.ts'
import { createFakeSummarizer } from './testing/fake-summarizer.ts'
import { createTempDirectory, event, openEngine } from './testing/temp-memory.ts'

const temp = createTempDirectory()
afterAll(() => temp.cleanup())
const dbPath = (name: string): string => join(temp.directory, `${name}.db`)

const conversation = StreamIds.conversation('c1')
const access: MemoryAccess = { conversationId: 'c1', projectId: 'p1', allowAllProjects: false }
const smallView = { maxNodeBytes: 128, viewUpperBytes: 4_000, viewLowerBytes: 2_000 }

const turns = (count: number, from = 0) =>
  Array.from({ length: count }, (_unused, index) => event({ conversationId: 'c1', projectId: 'p1', text: `turn ${from + index}: ${'detail '.repeat(6)}` }))

describe('memory tree', () => {
  it('builds every complete node, verbatim when small and summarized when large', async () => {
    const summarizer = createFakeSummarizer()
    const { engine, memory } = await openEngine({ path: dbPath('tree'), summarizer })
    await engine.append([...turns(5), event({ conversationId: 'c1', projectId: 'p1', role: 'assistant', text: 'long answer '.repeat(100) })])
    await engine.drain()
    const nodes = await memory.store.listNodes(conversation, 0, 0, 10)
    expect(nodes.map(node => node.model)).toEqual(['verbatim', 'verbatim', 'verbatim', 'verbatim', 'verbatim', 'fake-summarizer'])
    expect(nodes[0]?.text).toBe(`user: turn 0: ${'detail '.repeat(6)}`)
    const parents = await memory.store.getNodes(conversation, [
      { level: 1, idx: 0 },
      { level: 1, idx: 1 },
      { level: 1, idx: 2 },
      { level: 2, idx: 0 },
      { level: 2, idx: 1 },
    ])
    expect(parents.map(node => TreeMath.format(node.address))).toEqual(['0+2', '2+2', '4+2', '0+4'])
    expect(parents[0]?.model).toBe('concat')
    expect(parents.every(node => node.bytes <= 512)).toBe(true)
    memory.close()
  })

  it('zooms an internal node into its two children and a leaf into its full event, paginated', async () => {
    const { engine, memory } = await openEngine({ path: dbPath('zoom'), summarizer: createFakeSummarizer(), config: { zoomPageBytes: 1_000 } })
    const long = `BEGIN ${'x'.repeat(2_500)} END`
    await engine.append([...turns(3), event({ conversationId: 'c1', projectId: 'p1', role: 'tool_result', text: long })])
    await engine.drain()
    const node = await engine.zoom({ stream: conversation, address: '0+4', access })
    expect(node.kind === 'node' && node.lines.map(line => line.split('|')[0])).toEqual(['0+2', '2+2'])
    const leaf = await engine.zoom({ stream: conversation, address: '3+1', access })
    expect(leaf.kind === 'event' && [leaf.pageCount, leaf.text.startsWith('tool_result: BEGIN')]).toEqual([3, true])
    const last = await engine.zoom({ stream: conversation, address: '3+1', page: 2, access })
    expect(last.kind === 'event' && last.text.endsWith('END')).toBe(true)
    await expect(engine.zoom({ stream: conversation, address: '0+3', access })).rejects.toMatchObject({ code: 'invalid-address' })
    await expect(engine.zoom({ stream: conversation, address: '0+8', access })).rejects.toMatchObject({ code: 'out-of-range' })
    memory.close()
  })

  it('keeps every summary within the byte limit, retrying then clipping', async () => {
    const retried = createFakeSummarizer({ overshootAttempts: 2 })
    const first = await openEngine({ path: dbPath('retry'), summarizer: retried })
    await first.engine.append([event({ conversationId: 'c1', text: 'é'.repeat(600) })])
    await first.engine.drain()
    const [retriedLeaf] = await first.memory.store.listNodes(conversation, 0, 0, 1)
    expect(retried.requests.map(request => request.maxBytes)).toEqual([512, 409, 307])
    expect(retriedLeaf?.model).toBe('fake-summarizer')
    expect(Utf8.byteLength(retriedLeaf?.text ?? '')).toBeLessThanOrEqual(512)
    first.memory.close()

    const stubborn = createFakeSummarizer({ overshootAttempts: 99 })
    const second = await openEngine({ path: dbPath('clip'), summarizer: stubborn })
    await second.engine.append([event({ conversationId: 'c1', text: 'é'.repeat(600) })])
    await second.engine.drain()
    const [clippedLeaf] = await second.memory.store.listNodes(conversation, 0, 0, 1)
    expect(stubborn.requests).toHaveLength(4)
    expect(clippedLeaf?.model).toBe('clipped:fake-summarizer')
    expect(Utf8.byteLength(clippedLeaf?.text ?? '')).toBeLessThanOrEqual(512)
    expect((await second.engine.status()).summarizer.clips).toBe(1)
    second.memory.close()
  })
})

describe('persisted view', () => {
  it('only extends at the tail between merges and merges from above upper to at most lower', async () => {
    const { engine, memory } = await openEngine({ path: dbPath('sawtooth'), summarizer: createFakeSummarizer(), config: smallView })
    let previous = ''
    let batches = 0
    for (let turn = 0; turn < 240; turn++) {
      await engine.append(turns(1, turn))
      await engine.drain()
      const view = await memory.store.getView(conversation)
      if (!view) throw new Error('view missing')
      expect(view.bytes).toBe(Utf8.byteLength(view.rendered))
      expect(view.bytes).toBeLessThanOrEqual(smallView.viewUpperBytes)
      if (!view.rendered.startsWith(previous)) {
        batches++
        expect(view.bytes).toBeLessThanOrEqual(smallView.viewLowerBytes)
      }
      previous = view.rendered
    }
    expect(batches).toBeGreaterThan(1)
    const view = await memory.store.getView(conversation)
    const levels = view?.nodes.map(node => node.level) ?? []
    expect(levels[0]).toBeGreaterThan(levels.at(-1) ?? 0)
    expect(levels.slice(1).every((level, index) => level <= (levels[index] ?? 0))).toBe(true)
    memory.close()
  })

  it('is deterministic for the same history', async () => {
    const renders = await Promise.all(
      ['det-a', 'det-b'].map(async name => {
        const { engine, memory } = await openEngine({ path: dbPath(name), summarizer: createFakeSummarizer(), config: smallView })
        for (let batch = 0; batch < 6; batch++) {
          await engine.append(
            Array.from({ length: 40 }, (_unused, index) => ({
              eventKey: `${batch}:${index}`,
              harness: 'test',
              conversationId: 'c1',
              role: 'user' as const,
              createdAt: batch * 100 + index,
              text: `fact ${batch}.${index} ${'filler '.repeat(5)}`,
            })),
          )
          await engine.drain()
        }
        const rendered = (await memory.store.getView(conversation))?.rendered
        memory.close()
        return rendered
      }),
    )
    expect(renders[0]).toBeDefined()
    expect(renders[0]).toBe(renders[1])
  })

  it('reloads the persisted view byte-for-byte instead of rebuilding it', async () => {
    const path = dbPath('reload')
    const first = await openEngine({ path, summarizer: createFakeSummarizer(), config: smallView })
    await first.engine.append(turns(120))
    await first.engine.drain()
    const before = await first.engine.snapshot({ stream: conversation })
    await first.engine.close()
    first.memory.close()
    const second = await openEngine({ path, summarizer: createFakeSummarizer(), config: smallView })
    await second.engine.drain()
    const after = await second.engine.snapshot({ stream: conversation })
    expect(after.text).toBe(before.text)
    expect(after.viewVersion).toBe(before.viewVersion)
    second.memory.close()
  })
})

describe('snapshot barrier', () => {
  it('renders leaves still waiting for a summary raw and tagged instead of omitting them', async () => {
    const summarizer = createFakeSummarizer({ gated: true })
    const { engine, memory } = await openEngine({ path: dbPath('barrier'), summarizer })
    await engine.append([...turns(2), event({ conversationId: 'c1', projectId: 'p1', text: `needle ${'long '.repeat(200)}` }), ...turns(1, 9)])
    const pending = await engine.snapshot({ stream: conversation, barrierMs: 30 })
    expect(pending.barrierTimedOut).toBe(true)
    expect(pending.length).toBe(4)
    expect(pending.viewThroughPos).toBe(2)
    expect(pending.pendingCount).toBe(1)
    const pendingLines = ViewMath.lines(pending.pending)
    expect(pendingLines).toHaveLength(2)
    expect(pendingLines[0]).toMatch(/^2\+1\| \[pending summary\] user: needle long/)
    expect(Utf8.byteLength(pendingLines[0] ?? '')).toBeLessThan(600)
    expect(pendingLines[1]).toMatch(/^3\+1\| user: turn 9/)
    expect(pending.text).toBe(pending.view + pending.pending)

    summarizer.release()
    const settled = await engine.snapshot({ stream: conversation, barrierMs: 5_000 })
    expect(settled.barrierTimedOut).toBe(false)
    expect(settled.pending).toBe('')
    expect(settled.viewThroughPos).toBe(4)
    expect(settled.view.startsWith(pending.view)).toBe(true)
    memory.close()
  })

  it('leaves positions at or past endPos out of the snapshot', async () => {
    const { engine, memory } = await openEngine({ path: dbPath('end-pos'), summarizer: createFakeSummarizer({ gated: true }) })
    await engine.append(turns(3))
    const snapshot = await engine.snapshot({ stream: conversation, barrierMs: 0, endPos: 2 })
    expect(snapshot.length).toBe(2)
    expect(ViewMath.lines(snapshot.text).map(line => line.split('|')[0])).toEqual(['0+1', '1+1'])
    const built = await openEngine({ path: dbPath('end-pos-built'), summarizer: createFakeSummarizer() })
    await built.engine.append(turns(3))
    expect((await built.engine.snapshot({ stream: conversation, barrierMs: 5_000 })).viewThroughPos).toBe(3)
    const truncated = await built.engine.snapshot({ stream: conversation, barrierMs: 0, endPos: 2 })
    expect(ViewMath.lines(truncated.text).map(line => line.split('|')[0])).toEqual(['0+1', '1+1'])
    built.memory.close()
    memory.close()
  })
})

describe('recovery', () => {
  it('finishes an interrupted pipeline when a new engine opens the same database', async () => {
    const path = dbPath('recovery')
    const stalled = await openEngine({ path, summarizer: createFakeSummarizer({ gated: true }), config: smallView })
    await stalled.engine.append([...turns(60), event({ conversationId: 'c1', projectId: 'p1', text: 'big '.repeat(300) }), ...turns(40, 60)])
    await stalled.engine.snapshot({ stream: conversation, barrierMs: 20 })
    const stalledView = await stalled.memory.store.getView(conversation)
    expect(stalledView?.throughPos).toBe(60)

    const resumed = await openEngine({ path, summarizer: createFakeSummarizer(), config: smallView })
    await resumed.engine.drain()
    const snapshot = await resumed.engine.snapshot({ stream: conversation, barrierMs: 0 })
    expect(snapshot.viewThroughPos).toBe(101)
    expect(snapshot.pending).toBe('')
    const missing = await resumed.memory.store.listMissingLeaves(conversation, 0)
    expect(missing).toEqual([])
    expect(await resumed.memory.store.listBuildableParents(conversation)).toEqual([])
    stalled.memory.close()
    resumed.memory.close()
  })

  it('appends leaves that were built before a crash but never reached the view', async () => {
    const path = dbPath('orphan-leaves')
    const memory = openSqliteMemory({ path })
    const [appended] = await memory.store.appendEvents([
      {
        eventKey: 'orphan',
        harness: 'test',
        conversationId: 'c1',
        projectId: null,
        parentConversationId: null,
        role: 'user',
        createdAt: 1,
        text: 'built then crashed',
        bytes: 18,
        truncated: false,
        meta: {},
        streams: [conversation],
      },
    ])
    await memory.store.saveNode({
      stream: conversation,
      address: { level: 0, idx: 0 },
      text: 'user: built then crashed',
      bytes: 24,
      eventId: appended?.eventId ?? null,
      model: 'verbatim',
      createdAt: 1,
    })
    memory.close()
    const resumed = await openEngine({ path, summarizer: createFakeSummarizer() })
    await resumed.engine.drain()
    expect((await resumed.memory.store.getView(conversation))?.rendered).toBe('0+1| user: built then crashed\n')
    resumed.memory.close()
  })

  it('never loses history when the summarizer fails, and retries on the next append', async () => {
    const path = dbPath('failing')
    const broken = await openEngine({ path, summarizer: createFakeSummarizer({ failing: true }) })
    await broken.engine.append([event({ conversationId: 'c1', text: 'large '.repeat(200) })])
    await broken.engine.drain()
    const status = await broken.engine.status()
    expect(status.failures).toMatchObject({ count: 1, lastError: 'summarizer unavailable' })
    expect(status.failures.retryInMs).toBeGreaterThan(0)
    expect((await broken.engine.snapshot({ stream: conversation, barrierMs: 0 })).pendingCount).toBe(1)
    await broken.engine.close()
    broken.memory.close()
    const fixed = await openEngine({ path, summarizer: createFakeSummarizer() })
    await fixed.engine.append(turns(1))
    await fixed.engine.drain()
    expect((await fixed.engine.snapshot({ stream: conversation, barrierMs: 0 })).viewThroughPos).toBe(2)
    fixed.memory.close()
  })

  it('retries failed summaries on a backoff timer without waiting for another append', async () => {
    let failures = 2
    const flaky = createFakeSummarizer()
    const summarizer = {
      summarize: async (request: Parameters<typeof flaky.summarize>[0]) => {
        if (failures-- > 0) throw new Error('transient')
        return flaky.summarize(request)
      },
    }
    const { engine, memory } = await openEngine({ path: dbPath('backoff'), summarizer, config: { retryBaseMs: 5, retryMaxMs: 20 } })
    await engine.append([event({ conversationId: 'c1', text: 'large '.repeat(200) })])
    const snapshot = await engine.snapshot({ stream: conversation, barrierMs: 2_000 })
    expect([snapshot.pendingCount, snapshot.barrierTimedOut]).toEqual([0, false])
    expect((await engine.status()).failures.retryInMs).toBeNull()
    await engine.close()
    memory.close()
  })

  it('times out a hung summarizer and frees its concurrency slot', async () => {
    const hung = { summarize: () => new Promise<never>(() => {}) }
    const { engine, memory } = await openEngine({
      path: dbPath('hung'),
      summarizer: hung,
      config: { summaryTimeoutMs: 20, summaryRetries: 0, concurrency: 1, retryBaseMs: 60_000 },
    })
    await engine.append([event({ conversationId: 'c1', text: 'large '.repeat(200) }), ...turns(2)])
    await engine.drain()
    const status = await engine.status()
    expect(status.failures.lastError).toContain('timed out after 20 ms')
    expect(status.queue.running).toBe(0)
    await engine.close()
    memory.close()
  })
})

describe('compact view', () => {
  it('keeps a second, smaller view over the same tree and persists it like the main one', async () => {
    const committed: string[] = []
    const path = dbPath('compact')
    const memory = openSqliteMemory({ path })
    const { createMemoryEngine } = await import('@dshfiles/optmem-core')
    const engine = createMemoryEngine({
      store: memory.store,
      summarizer: createFakeSummarizer(),
      config: { ...smallView, compactUpperBytes: 900, compactLowerBytes: 450 },
      onViewCommitted: event => committed.push(event.kind),
    })
    await engine.start()
    await engine.append(turns(64))
    await engine.drain()
    const main = await engine.readView({ stream: conversation, kind: 'main' })
    const compact = await engine.readView({ stream: conversation, kind: 'compact' })
    expect(compact.throughPos).toBe(64)
    expect(compact.bytes).toBeLessThanOrEqual(900)
    expect(compact.lines.length).toBeLessThan(main.lines.length)
    expect(compact.nodes.reduce((sum, node) => sum + TreeMath.length(node), 0)).toBe(64)
    expect(committed).toContain('compact')
    const stored = await memory.store.getView(conversation, 'compact')
    expect(stored?.rendered).toBe(ViewMath.render(compact.lines))
    expect((await memory.store.getView(conversation))?.kind).toBe('main')
    await engine.close()
    memory.close()
  })

  it('migrates a version-1 database by keeping its views as the main kind', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const path = dbPath('migrate-v1')
    const first = openSqliteMemory({ path })
    first.database
      .exec(`DROP TABLE views; CREATE TABLE views (stream TEXT PRIMARY KEY, through_pos INTEGER NOT NULL, nodes TEXT NOT NULL, rendered TEXT NOT NULL, bytes INTEGER NOT NULL, version INTEGER NOT NULL, merge_pending INTEGER NOT NULL) STRICT;
      INSERT INTO views VALUES ('conversation:c1', 1, '[[0,0]]', '0+1| user: old\n', 16, 3, 0); PRAGMA user_version = 1;`)
    first.close()
    const raw = new DatabaseSync(path)
    expect(raw.prepare('PRAGMA user_version').get()?.['user_version']).toBe(1)
    raw.close()
    const migrated = openSqliteMemory({ path })
    const view = await migrated.store.getView(conversation, 'main')
    expect([view?.kind, view?.version, view?.rendered]).toEqual(['main', 3, '0+1| user: old\n'])
    expect(await migrated.store.getView(conversation, 'compact')).toBeUndefined()
    migrated.close()
  })

  it('caps the pending tail and names the collapsed positions explicitly', async () => {
    const summarizer = createFakeSummarizer({ gated: true })
    const { engine, memory } = await openEngine({ path: dbPath('pending-cap'), summarizer, config: { pendingTailBytes: 1_200 } })
    await engine.append(Array.from({ length: 12 }, () => event({ conversationId: 'c1', text: 'large '.repeat(200) })))
    const snapshot = await engine.snapshot({ stream: conversation, barrierMs: 0 })
    const lines = ViewMath.lines(snapshot.pending)
    expect(lines[0]).toMatch(/^\d+ more pending events \(positions 0\.\.\d+\) — use memory_context$/)
    expect(Utf8.byteLength(snapshot.pending)).toBeLessThanOrEqual(1_200 + Utf8.byteLength(`${lines[0]}\n`))
    expect(lines.at(-1)?.startsWith('11+1| [pending summary]')).toBe(true)
    summarizer.release()
    await engine.close()
    memory.close()
  })

  it('builds parents before backlog leaves while a merge batch waits on them', async () => {
    const fake = createFakeSummarizer()
    const summarizer = {
      summarize: async (request: Parameters<typeof fake.summarize>[0]) => {
        await new Promise(resolve => setTimeout(resolve, 1))
        return fake.summarize(request)
      },
    }
    const config = { maxNodeBytes: 64, viewUpperBytes: 500, viewLowerBytes: 250, compactUpperBytes: 500, compactLowerBytes: 250, concurrency: 1 }
    const { engine, memory } = await openEngine({ path: dbPath('priority'), summarizer, config })
    await engine.append(Array.from({ length: 48 }, (_unused, index) => event({ conversationId: 'c1', text: `event ${index} ${'body '.repeat(30)}` })))
    await engine.drain()
    const kinds = fake.requests.map(request => request.kind)
    expect(kinds.indexOf('merge')).toBeLessThan(kinds.lastIndexOf('leaf'))
    await engine.close()
    memory.close()
  })

  it('routes each summary by the thread whose event it covers, and records that route per node', async () => {
    const fake = createFakeSummarizer()
    const summarizer = {
      summarize: async (request: Parameters<typeof fake.summarize>[0]) => ({
        text: (await fake.summarize(request)).text,
        model: `route-of-${request.conversationId}`,
      }),
    }
    const { engine, memory } = await openEngine({ path: dbPath('per-thread-model'), summarizer })
    await engine.append([
      event({ conversationId: 'c1', projectId: 'p1', text: 'first thread '.repeat(60) }),
      event({ conversationId: 'c2', projectId: 'p1', text: 'second thread '.repeat(60) }),
    ])
    await engine.drain()
    const project = StreamIds.project('p1')
    const nodes = await memory.store.listNodes(project, 0, 0, 2)
    expect(nodes.map(node => node.model)).toEqual(['route-of-c1', 'route-of-c2'])
    const merge = fake.requests.find(request => request.kind === 'merge' && request.stream === project)
    expect(merge?.conversationId).toBe('c2')
    await engine.close()
    memory.close()
  })
})
