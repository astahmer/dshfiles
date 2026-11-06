import { tracerLayer } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, FileSystem, Layer, Path, Schema } from 'effect'
import { HistoryConfig, HistoryIndex } from './history.js'
import { jobStateSchema } from './types.js'

const record = (type: string, data: Record<string, string | number | boolean>): string => `${JSON.stringify({ type, data })}\n`

const sessionLog =
  record('session', { version: 4, id: 'session-aaaa', createdAt: 1, cwd: '/Users/astahmer/dev/dshfiles' }) +
  record('session/title', { title: 'Fix the delayed rebase button' }) +
  record('job/registered', { jobId: 'bash-1', owner: 'session-aaaa', kind: 'bash', label: 'cd /x && pnpm test', startedAt: 1_000 }) +
  record('job/settled', {
    jobId: 'bash-1',
    owner: 'session-aaaa',
    kind: 'bash',
    label: 'cd /x && pnpm test',
    startedAt: 1_000,
    finishedAt: 2_000,
    status: 'completed',
    cause: 'producer',
    detail: 'exit code: 0',
  }) +
  record('job/registered', { jobId: 'bash-2', owner: 'session-aaaa', kind: 'bash', label: 'jj log', startedAt: 3_000 })

const scratchSessions = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'background-jobs-' })
  const sessionDirectory = path.join(root, '--Users-astahmer-dev-dshfiles--', 'session-aaaa')
  yield* fileSystem.makeDirectory(sessionDirectory, { recursive: true })
  const logPath = path.join(sessionDirectory, 'session.v4.jsonl')
  yield* fileSystem.writeFileString(logPath, sessionLog)
  return { root, statePath: path.join(root, 'state.json'), logPath }
})

const historyIndex = (config: Parameters<typeof HistoryConfig.layer>[0]) =>
  Layer.build(HistoryIndex.layer.pipe(Layer.provide(HistoryConfig.layer(config)))).pipe(Effect.map(context => Context.get(context, HistoryIndex)))

const sortedIds = (jobs: ReadonlyMap<string, unknown>) => [...jobs.keys()].sort()

describe('job history index', () => {
  it.layer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))(it => {
    it.effect('records job lifecycle events, session titles and a settled/unsettled status', () =>
      Effect.gen(function* () {
        const index = yield* historyIndex(yield* scratchSessions)
        const indexing = yield* index.pass
        const snapshot = yield* index.snapshot

        expect(sortedIds(snapshot.jobs)).toEqual(['bash-1', 'bash-2'])
        expect(snapshot.jobs.get('bash-1')).toMatchObject({ settled: true, status: 'completed', detail: 'exit code: 0', finishedAt: 2_000 })
        expect(snapshot.jobs.get('bash-2')).toMatchObject({ settled: false, status: null })
        expect(snapshot.sessions.get('session-aaaa')).toEqual({
          id: 'session-aaaa',
          title: 'Fix the delayed rebase button',
          cwd: '/Users/astahmer/dev/dshfiles',
          project: '--Users-astahmer-dev-dshfiles--',
        })
        expect(indexing).toMatchObject({ active: false, caughtUp: true, historyRows: 2, files: 1, indexedFiles: 1, lastError: null })
      }),
    )

    it.effect('queues a refresh behind the running pass instead of returning before indexing', () =>
      Effect.gen(function* () {
        const index = yield* historyIndex(yield* scratchSessions)
        const [scheduled, refresh] = yield* Effect.all([index.pass, index.pass], { concurrency: 'unbounded' })
        expect(scheduled.historyRows).toBe(2)
        expect(refresh).toMatchObject({ active: false, historyRows: 2 })
      }),
    )

    it.effect('records a background-jobs history pass span with the files it read', () =>
      Effect.gen(function* () {
        const index = yield* historyIndex(yield* scratchSessions)
        const recorder = yield* Effect.acquireRelease(
          Effect.sync(() => recordSpans()),
          spans => Effect.sync(() => spans.stop()),
        )
        yield* index.pass.pipe(Effect.provide(tracerLayer))
        expect(recorder.span('background-jobs history pass').attributes).toEqual({
          'dshx.background-jobs.files': 1,
          'dshx.background-jobs.read_files': 1,
          'dshx.background-jobs.caught_up': true,
        })
      }),
    )

    it.effect('resumes from the persisted offset and reads only the appended records', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const scratch = yield* scratchSessions
        const first = yield* historyIndex(scratch)
        yield* first.pass

        yield* fileSystem.writeFileString(
          scratch.logPath,
          record('job/registered', { jobId: 'bash-3', owner: 'session-aaaa', kind: 'bash', label: 'pnpm lint', startedAt: 4_000 }),
          { flag: 'a' },
        )
        const second = yield* historyIndex(scratch)
        yield* second.pass
        expect(sortedIds((yield* second.snapshot).jobs)).toEqual(['bash-1', 'bash-2', 'bash-3'])
        const saved = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(jobStateSchema))(yield* fileSystem.readFileString(scratch.statePath))
        expect(saved.schemaVersion).toBe(1)
        expect(Object.keys(saved.jobs).sort()).toEqual(['bash-1', 'bash-2', 'bash-3'])
      }),
    )

    it.effect('rebuilds from the logs when the state file is malformed', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const scratch = yield* scratchSessions
        yield* fileSystem.writeFileString(scratch.statePath, '{"schemaVersion":99,"offsets":{}}')
        const index = yield* historyIndex(scratch)
        expect((yield* index.pass).historyRows).toBe(2)
      }),
    )

    it.effect('bounds retained history to the configured maximum', () =>
      Effect.gen(function* () {
        const index = yield* historyIndex({ ...(yield* scratchSessions), maxJobs: 1 })
        yield* index.pass
        expect(sortedIds((yield* index.snapshot).jobs)).toEqual(['bash-2'])
      }),
    )

    it.effect('clears the indexing flag when a pass dies instead of leaving it stuck active', () =>
      Effect.gen(function* () {
        const scratch = yield* scratchSessions
        const failingFileSystem = Layer.effect(
          FileSystem.FileSystem,
          Effect.map(FileSystem.FileSystem, fileSystem => ({
            ...fileSystem,
            readDirectoryEntries: () => Effect.die('directory read failed'),
          })),
        ).pipe(Layer.provide(NodeFileSystem.layer))
        const index = yield* Layer.build(HistoryIndex.layer.pipe(Layer.provide(Layer.mergeAll(HistoryConfig.layer(scratch), failingFileSystem)))).pipe(
          Effect.map(context => Context.get(context, HistoryIndex)),
        )

        yield* Effect.exit(index.pass)

        expect((yield* index.snapshot).indexing.active).toBe(false)
      }),
    )

    it.effect('tolerates a missing sessions root', () =>
      Effect.gen(function* () {
        const path = yield* Path.Path
        const scratch = yield* scratchSessions
        const index = yield* historyIndex({ root: path.join(scratch.root, 'missing'), statePath: scratch.statePath })
        expect(yield* index.pass).toMatchObject({ historyRows: 0, files: 0, lastError: null })
      }),
    )

    it.effect('keeps indexing the other logs when one log cannot be read, and reports it', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const scratch = yield* scratchSessions
        const broken = path.join(scratch.root, '--Users-astahmer-dev-dshfiles--', 'session-bbbb')
        yield* fileSystem.makeDirectory(broken, { recursive: true })
        yield* fileSystem.writeFileString(path.join(broken, 'session.v4.jsonl.zstd'), 'not a zstandard frame')
        const index = yield* historyIndex(scratch)
        const indexing = yield* index.pass
        expect(indexing).toMatchObject({ historyRows: 2, files: 2, indexedFiles: 1, lastIndexedAt: null })
        expect(indexing.lastError).toContain('session-bbbb/session.v4.jsonl.zstd')
      }),
    )
  })
})
