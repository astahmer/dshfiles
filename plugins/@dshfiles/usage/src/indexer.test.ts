import { tracerLayer } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Option, Path } from 'effect'
import { SessionLogFiles, SessionLogIndex } from './indexer.js'
import { UsageRepo } from './store.js'
import { PlatformTest, usageRepoTest } from './test-layers.js'

const FIXTURES = new URL('../fixtures/sessions', import.meta.url).pathname
const SUBAGENT_LOG = `${FIXTURES}/-home-user-dev-sample/557dd85e-cb22-4b10-a70e-39dabec1bfde/session.v4.jsonl.zstd`

const everything = { from: 0, to: Number.MAX_SAFE_INTEGER, sort: 'startedAt', direction: 'desc', limit: 500 } as const

/** A fresh in-memory usage index fed from real session logs on disk. */
const indexTest = () => SessionLogIndex.layer.pipe(Layer.provideMerge(SessionLogFiles.layer), Layer.provideMerge(usageRepoTest()))

const snapshot = Effect.map(
  UsageRepo.use(repo => repo.requests(everything)),
  page => page.rows.map(row => [row.id, row.status, row.input, row.output, row.durationMs]),
)

const indexAll = (root: string) => SessionLogIndex.use(index => index.indexAll({ root }))
const indexFile = (path: string) => SessionLogIndex.use(index => index.indexFile({ path }))

describe('SessionLogIndex', () => {
  it.layer(PlatformTest)(it => {
    it.effect('turns real session logs into requests with purpose, status, tokens and timings', () =>
      Effect.gen(function* () {
        expect(yield* indexAll(FIXTURES)).toEqual({ files: 3, rows: 238 })

        const page = yield* UsageRepo.use(repo => repo.requests(everything))
        expect(page.statusCounts).toEqual({ all: 235, ok: 232, aborted: 2, failed: 1 })
        expect(page.purposeCounts).toEqual({ agent: 7, subagent: 219, compaction: 6, title: 3 })

        expect(page.rows.find(row => row.id === '557dd85e-cb22-4b10-a70e-39dabec1bfde#1333')).toMatchObject({
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
        expect(page.rows.find(row => row.status === 'failed')).toMatchObject({
          project: 'other',
          purpose: 'agent',
          errorCode: 'ACP_REQUEST',
          stopReason: 'error',
          input: null,
        })
        expect(page.rows.filter(row => row.status === 'aborted').map(row => [row.turn, row.step, row.stopReason])).toEqual(
          expect.arrayContaining([
            [5, 28, 'aborted'],
            [4, 1, 'aborted'],
          ]),
        )
        const compaction = page.rows.filter(row => row.purpose === 'compaction')
        expect(compaction.every(row => row.input !== null && row.ttftMs === null && (row.durationMs ?? 0) > 0)).toBe(true)
        const titles = page.rows.filter(row => row.purpose === 'title')
        expect(titles.every(row => row.input === null && row.durationMs !== null)).toBe(true)
      }).pipe(Effect.provide(indexTest())),
    )

    it.effect('records a usage index span with the files and rows of one pass', () =>
      Effect.gen(function* () {
        const recorder = yield* Effect.acquireRelease(Effect.sync(recordSpans), spans => Effect.sync(() => spans.stop()))
        yield* indexAll(FIXTURES).pipe(Effect.provide(tracerLayer))
        expect(recorder.span('usage index').attributes).toEqual({ 'dshx.usage.files': 3, 'dshx.usage.rows': 238 })
      }).pipe(Effect.provide(indexTest())),
    )

    it.effect('searches by model, provider or project and counts every status for the chips', () =>
      Effect.gen(function* () {
        const repo = yield* UsageRepo
        yield* indexAll(FIXTURES)
        const other = yield* repo.requests({ ...everything, search: 'OTHER' })
        expect(new Set(other.rows.map(row => row.project))).toEqual(new Set(['other']))
        const failedOnly = yield* repo.requests({ ...everything, search: 'other', status: 'failed' })
        expect(failedOnly.rows).toHaveLength(1)
        expect(failedOnly.statusCounts.all).toBe(other.total)
      }).pipe(Effect.provide(indexTest())),
    )

    it.effect('resumes from the stored offset, reads only what the log gained, and leaves a torn frame for later', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'usage-indexer-' })
        const target = path.join(root, 'project', 'session-x', 'session.v4.jsonl.zstd')
        yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true })
        const bytes = yield* fileSystem.readFile(SUBAGENT_LOG)
        const cut = Math.floor(bytes.length * 0.55)
        yield* fileSystem.writeFile(target, bytes.subarray(0, cut))

        const resumed = yield* Effect.gen(function* () {
          const repo = yield* UsageRepo
          expect(yield* indexFile(target)).toBeGreaterThan(0)
          const cursor = Option.getOrUndefined(yield* repo.fileCursor(target))
          expect(cursor?.offset).toBeLessThan(cut)
          expect(cursor?.size).toBe(cut)

          expect(yield* indexFile(target)).toBe(0)

          yield* fileSystem.writeFile(target, bytes.subarray(cut), { flag: 'a' })
          yield* indexFile(target)
          expect(Option.getOrUndefined(yield* repo.fileCursor(target))?.offset).toBe(bytes.length)
          return yield* snapshot
        }).pipe(Effect.provide(indexTest()))

        const oneShotTarget = path.join(root, 'copy', 'session-x', 'session.v4.jsonl.zstd')
        yield* fileSystem.makeDirectory(path.dirname(oneShotTarget), { recursive: true })
        yield* fileSystem.copyFile(SUBAGENT_LOG, oneShotTarget)
        const oneShot = yield* indexFile(oneShotTarget).pipe(Effect.andThen(snapshot), Effect.provide(indexTest()))
        expect(resumed).toEqual(oneShot)
      }),
    )

    it.effect('reads only the newest generation of a session', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'usage-indexer-' })
        const sessionDirectory = path.join(root, 'project', 'session-x')
        yield* fileSystem.makeDirectory(sessionDirectory, { recursive: true })
        yield* fileSystem.copyFile(SUBAGENT_LOG, path.join(sessionDirectory, 'session.v4.jsonl.zstd'))
        yield* fileSystem.copyFile(SUBAGENT_LOG, path.join(sessionDirectory, 'session.v5.jsonl.zstd'))
        expect((yield* indexAll(root)).files).toBe(1)
        expect(yield* UsageRepo.use(repo => repo.fileCursor(path.join(sessionDirectory, 'session.v4.jsonl.zstd')))).toEqual(Option.none())
      }).pipe(Effect.provide(indexTest())),
    )
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

  it.layer(PlatformTest)(it => {
    it.effect('gives a title row the usage the log never kept, and counts the call once', () =>
      Effect.gen(function* () {
        const repo = yield* UsageRepo
        yield* repo.insertLiveCall(liveTitle)
        yield* indexAll(FIXTURES)
        expect(yield* repo.reconcileLiveCalls(liveTitle.startedAt + 1_000)).toBe(1)
        const titles = (yield* repo.requests({ ...everything, purposes: ['title'], sessionId: liveTitle.sessionId })).rows
        expect(titles).toHaveLength(1)
        expect(titles[0]).toMatchObject({ id: '557dd85e-cb22-4b10-a70e-39dabec1bfde#19', input: 812, output: 9, ttftMs: 900 })

        yield* indexAll(FIXTURES)
        expect((yield* repo.requests({ ...everything, purposes: ['title'], sessionId: liveTitle.sessionId })).rows[0]?.input).toBe(812)
      }).pipe(Effect.provide(indexTest())),
    )

    it.effect('counts a live memory call on its own when no log row exists', () =>
      Effect.gen(function* () {
        const repo = yield* UsageRepo
        yield* repo.insertLiveCall({ ...liveTitle, id: 'live:memory', purpose: 'memory' })
        expect((yield* repo.requests({ ...everything, purposes: ['memory'] })).rows.map(row => row.id)).toEqual(['live:memory'])
      }).pipe(Effect.provide(usageRepoTest())),
    )

    it.effect('lets a waiting side call stand alone once no log row turns up in time', () =>
      Effect.gen(function* () {
        const repo = yield* UsageRepo
        yield* repo.insertLiveCall({ ...liveTitle, sessionId: 'session-unknown' })
        expect((yield* repo.requests(everything)).total).toBe(0)
        yield* repo.reconcileLiveCalls(liveTitle.startedAt + 11 * 60_000)
        expect((yield* repo.requests(everything)).total).toBe(1)
      }).pipe(Effect.provide(usageRepoTest())),
    )
  })
})
