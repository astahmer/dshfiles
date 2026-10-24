import { recordSpans } from '@dshfiles/dshx/tracing'
import { appendFile, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createUsageIndexService } from './indexer.js'
import { readLogFrom } from './session-log.js'
import { openUsageStore, type UsageStore } from './store.js'

const usageIndexService = createUsageIndexService({ fileSystem: { readdir, stat }, readLogFrom })

const FIXTURES = new URL('../fixtures/sessions', import.meta.url).pathname
const SUBAGENT_LOG = join(FIXTURES, '-home-user-dev-sample/557dd85e-cb22-4b10-a70e-39dabec1bfde/session.v4.jsonl.zstd')

const everything = { from: 0, to: Number.MAX_SAFE_INTEGER, sort: 'startedAt', direction: 'desc', limit: 500 } as const

const scratchDirs: string[] = []
const scratch = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'usage-indexer-'))
  scratchDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const snapshot = (store: UsageStore) => store.requests(everything).rows.map(row => [row.id, row.status, row.input, row.output, row.durationMs])

describe('indexSessionLogs', () => {
  it('turns real session logs into requests with purpose, status, tokens and timings', async () => {
    const store = openUsageStore(':memory:')
    expect(await usageIndexService.indexSessionLogs({ store, root: FIXTURES })).toEqual({ files: 3, rows: 238 })

    const page = store.requests(everything)
    expect(page.statusCounts).toEqual({ all: 235, ok: 232, aborted: 2, failed: 1 })
    expect(page.purposeCounts).toEqual({ agent: 7, subagent: 219, compaction: 6, title: 3 })

    const settled = page.rows.find(row => row.id === '557dd85e-cb22-4b10-a70e-39dabec1bfde#1333')
    expect(settled).toMatchObject({
      purpose: 'subagent',
      project: 'sample',
      provider: 'codex-emialex',
      model: 'gpt-6.1-sol',
      messageId: 'c4a896f1-9123-4e73-9853-48f4da737b0a',
      turn: 6,
      step: 3,
      input: 368,
      cacheRead: 61952,
      output: 52,
      durationMs: 3457,
      ttftMs: 2586,
      status: 'ok',
      stopReason: 'toolUse',
    })

    const failed = page.rows.find(row => row.status === 'failed')
    expect(failed).toMatchObject({ project: 'other', purpose: 'agent', errorCode: 'ACP_REQUEST', stopReason: 'error', input: null })

    const aborted = page.rows.filter(row => row.status === 'aborted').map(row => [row.turn, row.step, row.stopReason])
    expect(aborted).toEqual(
      expect.arrayContaining([
        [5, 28, 'aborted'],
        [4, 1, 'aborted'],
      ]),
    )

    const compaction = page.rows.filter(row => row.purpose === 'compaction')
    expect(compaction.every(row => row.input !== null && row.ttftMs === null && (row.durationMs ?? 0) > 0)).toBe(true)

    const titles = page.rows.filter(row => row.purpose === 'title')
    expect(titles.every(row => row.input === null && row.durationMs !== null)).toBe(true)
  })

  it('records a usage index span with the files and rows of one pass', async () => {
    using recorder = recordSpans()
    await usageIndexService.indexSessionLogs({ store: openUsageStore(':memory:'), root: FIXTURES })
    expect(recorder.span('usage index').attributes).toEqual({ 'dshx.usage.files': 3, 'dshx.usage.rows': 238 })
  })

  it('searches by model, provider or project and counts every status for the chips', async () => {
    const store = openUsageStore(':memory:')
    await usageIndexService.indexSessionLogs({ store, root: FIXTURES })
    const other = store.requests({ ...everything, search: 'OTHER' })
    expect(new Set(other.rows.map(row => row.project))).toEqual(new Set(['other']))
    const failedOnly = store.requests({ ...everything, search: 'other', status: 'failed' })
    expect(failedOnly.rows).toHaveLength(1)
    expect(failedOnly.statusCounts.all).toBe(other.total)
  })

  it('resumes from the stored offset, reads only what the log gained, and leaves a torn frame for later', async () => {
    const root = await scratch()
    const target = join(root, 'project', 'session-x', 'session.v4.jsonl.zstd')
    await mkdir(dirname(target), { recursive: true })
    const bytes = await readFile(SUBAGENT_LOG)
    const cut = Math.floor(bytes.length * 0.55)
    await writeFile(target, bytes.subarray(0, cut))

    const store = openUsageStore(':memory:')
    const firstRows = await usageIndexService.indexSessionLog({ store, path: target })
    expect(firstRows).toBeGreaterThan(0)
    const cursor = store.fileCursor(target)
    expect(cursor?.offset).toBeLessThan(cut)
    expect(cursor?.size).toBe(cut)

    expect(await usageIndexService.indexSessionLog({ store, path: target })).toBe(0)

    await appendFile(target, bytes.subarray(cut))
    await usageIndexService.indexSessionLog({ store, path: target })
    expect(store.fileCursor(target)?.offset).toBe(bytes.length)

    const oneShot = openUsageStore(':memory:')
    const oneShotTarget = join(root, 'copy', 'session-x', 'session.v4.jsonl.zstd')
    await mkdir(dirname(oneShotTarget), { recursive: true })
    await copyFile(SUBAGENT_LOG, oneShotTarget)
    await usageIndexService.indexSessionLog({ store: oneShot, path: oneShotTarget })
    expect(snapshot(store)).toEqual(snapshot(oneShot))
  })

  it('reads only the newest generation of a session', async () => {
    const root = await scratch()
    const sessionDir = join(root, 'project', 'session-x')
    await mkdir(sessionDir, { recursive: true })
    await copyFile(SUBAGENT_LOG, join(sessionDir, 'session.v4.jsonl.zstd'))
    await copyFile(SUBAGENT_LOG, join(sessionDir, 'session.v5.jsonl.zstd'))
    const store = openUsageStore(':memory:')
    expect((await usageIndexService.indexSessionLogs({ store, root })).files).toBe(1)
    expect(store.fileCursor(join(sessionDir, 'session.v4.jsonl.zstd'))).toBeUndefined()
  })
})

describe('live side calls', () => {
  const liveTitle = {
    id: 'live:557dd85e-cb22-4b10-a70e-39dabec1bfde:1791651435600:title',
    sessionId: '557dd85e-cb22-4b10-a70e-39dabec1bfde',
    seq: null,
    messageId: null,
    turn: null,
    step: null,
    purpose: 'title',
    source: 'live',
    provider: 'codex-emialex',
    model: 'gpt-6.1-sol',
    startedAt: 1791651435600,
    endedAt: 1791651437800,
    ttftMs: 900,
    usage: { input: 812, cacheRead: 0, cacheWrite: 0, output: 9, reasoning: 0 },
    status: 'ok',
    stopReason: 'stop',
    errorCode: null,
  } as const

  it('gives a title row the usage the log never kept, and counts the call once', async () => {
    const store = openUsageStore(':memory:')
    store.insertLiveCall(liveTitle)
    await usageIndexService.indexSessionLogs({ store, root: FIXTURES })
    expect(store.reconcileLiveCalls(liveTitle.startedAt + 1_000)).toBe(1)
    const titles = store.requests({ ...everything, purposes: ['title'], sessionId: liveTitle.sessionId }).rows
    expect(titles).toHaveLength(1)
    expect(titles[0]).toMatchObject({ id: '557dd85e-cb22-4b10-a70e-39dabec1bfde#19', input: 812, output: 9, ttftMs: 900 })

    await usageIndexService.indexSessionLogs({ store, root: FIXTURES })
    expect(store.requests({ ...everything, purposes: ['title'], sessionId: liveTitle.sessionId }).rows[0]?.input).toBe(812)
  })

  it('counts a live memory call on its own when no log row exists', () => {
    const store = openUsageStore(':memory:')
    store.insertLiveCall({ ...liveTitle, id: 'live:memory', purpose: 'memory' })
    expect(store.requests({ ...everything, purposes: ['memory'] }).rows.map(row => row.id)).toEqual(['live:memory'])
  })

  it('lets a waiting side call stand alone once no log row turns up in time', () => {
    const store = openUsageStore(':memory:')
    store.insertLiveCall({ ...liveTitle, sessionId: 'session-unknown' })
    expect(store.requests(everything).total).toBe(0)
    store.reconcileLiveCalls(liveTitle.startedAt + 11 * 60_000)
    expect(store.requests(everything).total).toBe(1)
  })
})
