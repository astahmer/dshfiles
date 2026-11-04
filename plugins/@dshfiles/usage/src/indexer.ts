import { pluginAttributes } from '@dshfiles/dshx/tracing'
import { Context, Effect, FileSystem, Layer, Option, Path, Stream } from 'effect'
import type { UsageStoreFailed } from './errors.js'
import { UsageFoldModel, type ToolSourceMetadata } from './fold.js'
import { type LogChunk, readLogFrom, type SessionLogReadFailed } from './session-log.js'
import { UsageRepo } from './store.js'

const LOG_NAME = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/
const SLICE_BYTES = 4 * 1024 * 1024
const STAT_CONCURRENCY = 16
const EMPTY_TOOL_SOURCES: ReadonlyMap<string, ToolSourceMetadata> = new Map()

export interface LogFileInfo {
  readonly size: number
  readonly mtimeMs: number
}

/** The session-log tree on disk: `<root>/<project>/<session>/session.v<N>.jsonl[.zstd]`. */
export class SessionLogFiles extends Context.Service<
  SessionLogFiles,
  {
    /** The newest log generation of every session under `root`; an unreadable directory is skipped. */
    readonly discover: (root: string) => Stream.Stream<string>
    readonly stat: (path: string) => Effect.Effect<Option.Option<LogFileInfo>>
    readonly read: (input: { readonly path: string; readonly fromOffset: number; readonly size: number }) => Effect.Effect<LogChunk, SessionLogReadFailed>
  }
>()('@dshfiles/usage/SessionLogFiles') {
  static readonly layer = Layer.effect(
    SessionLogFiles,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const directories = (directory: string) =>
        fileSystem.readDirectoryEntries(directory).pipe(
          Effect.map(entries => entries.filter(entry => entry.type === 'Directory').map(entry => path.join(directory, entry.name))),
          Effect.orElseSucceed((): ReadonlyArray<string> => []),
        )

      const newestGeneration = (sessionDirectory: string) =>
        fileSystem.readDirectory(sessionDirectory).pipe(
          Effect.orElseSucceed((): ReadonlyArray<string> => []),
          Effect.map(names => {
            const generations = names.flatMap(name => {
              const match = LOG_NAME.exec(name)
              return match === null ? [] : [{ name, version: Number(match[1] ?? 0) }]
            })
            const newest = generations.reduce<{ readonly name: string; readonly version: number } | undefined>(
              (best, generation) => (best === undefined || generation.version > best.version ? generation : best),
              undefined,
            )
            return newest === undefined ? [] : [path.join(sessionDirectory, newest.name)]
          }),
        )

      return SessionLogFiles.of({
        discover: root =>
          Stream.fromIterableEffect(directories(root)).pipe(
            Stream.flatMap(project => Stream.fromIterableEffect(directories(project))),
            Stream.flatMap(session => Stream.fromIterableEffect(newestGeneration(session))),
          ),
        stat: filePath =>
          fileSystem.stat(filePath).pipe(
            Effect.map(info =>
              Option.some({ size: Number(info.size), mtimeMs: Option.match(info.mtime, { onNone: () => 0, onSome: date => date.getTime() }) }),
            ),
            Effect.orElseSucceed(() => Option.none<LogFileInfo>()),
          ),
        read: input => readLogFrom(input).pipe(Effect.provideService(FileSystem.FileSystem, fileSystem)),
      })
    }),
  )
}

/** Folds session logs into the usage index, resuming each log at the offset and fold state it last committed. */
export class SessionLogIndex extends Context.Service<
  SessionLogIndex,
  {
    /** Index one log; returns the request rows it committed. */
    readonly indexFile: (input: {
      readonly path: string
      readonly toolSources?: ReadonlyMap<string, ToolSourceMetadata>
    }) => Effect.Effect<number, SessionLogReadFailed | UsageStoreFailed>
    readonly indexAll: (input: {
      readonly root: string
      readonly toolSources?: ReadonlyMap<string, ToolSourceMetadata>
    }) => Effect.Effect<{ readonly files: number; readonly rows: number }, SessionLogReadFailed | UsageStoreFailed>
  }
>()('@dshfiles/usage/SessionLogIndex') {
  static readonly layer = Layer.effect(
    SessionLogIndex,
    Effect.gen(function* () {
      const files = yield* SessionLogFiles
      const repo = yield* UsageRepo
      const path = yield* Path.Path

      const indexStatted = Effect.fnUntraced(function* (input: {
        readonly path: string
        readonly info: LogFileInfo
        readonly toolSources?: ReadonlyMap<string, ToolSourceMetadata> | undefined
      }) {
        const info = input.info
        const cursor = Option.getOrUndefined(yield* repo.fileCursor(input.path))
        if (cursor !== undefined && cursor.size === info.size && cursor.mtime_ms === info.mtimeMs) return 0
        const resumed = cursor === undefined || info.size < cursor.offset ? undefined : UsageFoldModel.decodeFoldState(cursor.state)
        const fallbackSessionId = path.basename(path.dirname(input.path))
        let state = resumed ?? UsageFoldModel.initialFoldState()
        let offset = resumed === undefined || cursor === undefined ? 0 : cursor.offset
        let rows = 0
        while (offset < info.size) {
          const window = Math.min(info.size, offset + SLICE_BYTES)
          const sliced = yield* files.read({ path: input.path, fromOffset: offset, size: window })
          // A frame larger than one slice: read through to the end of the file instead of stalling on it.
          const chunk =
            sliced.endOffset === offset && window < info.size ? yield* files.read({ path: input.path, fromOffset: offset, size: info.size }) : sliced
          if (chunk.endOffset === offset) break
          const folded = UsageFoldModel.foldRecords({
            state,
            records: chunk.records,
            sessionId: fallbackSessionId,
            toolSources: input.toolSources ?? EMPTY_TOOL_SOURCES,
          })
          state = folded.state
          offset = chunk.endOffset
          yield* repo.commitLogSlice({
            path: input.path,
            sessionId: state.session?.id ?? fallbackSessionId,
            offset,
            // An unfinished pass records no size, so the next one resumes instead of skipping.
            size: offset >= info.size ? info.size : -1,
            mtimeMs: info.mtimeMs,
            state: JSON.stringify(state),
            session: state.session,
            rows: folded.rows,
            tools: folded.tools,
          })
          rows += folded.rows.length
          yield* Effect.yieldNow
        }
        if (offset < info.size) {
          // A torn final frame: remember the file as seen, it is re-read once the writer completes it.
          yield* repo.commitLogSlice({
            path: input.path,
            sessionId: state.session?.id ?? fallbackSessionId,
            offset,
            size: info.size,
            mtimeMs: info.mtimeMs,
            state: JSON.stringify(state),
            session: state.session,
            rows: [],
            tools: [],
          })
        }
        return rows
      })

      const indexFile = Effect.fnUntraced(function* (input: { readonly path: string; readonly toolSources?: ReadonlyMap<string, ToolSourceMetadata> }) {
        const found = yield* files.stat(input.path)
        if (Option.isNone(found)) return 0
        return yield* indexStatted({ path: input.path, info: found.value, toolSources: input.toolSources })
      })

      const indexAll = Effect.fn('usage index')(function* (input: { readonly root: string; readonly toolSources?: ReadonlyMap<string, ToolSourceMetadata> }) {
        const totals = yield* files.discover(input.root).pipe(
          // Stat ahead concurrently; the folds and their writes stay one log at a time.
          Stream.mapEffect(logPath => Effect.map(files.stat(logPath), info => ({ path: logPath, info })), { concurrency: STAT_CONCURRENCY }),
          Stream.mapEffect(found =>
            Option.match(found.info, {
              onNone: () => Effect.succeed(0),
              onSome: info => indexStatted({ path: found.path, info, toolSources: input.toolSources }),
            }),
          ),
          Stream.runFold(
            () => ({ files: 0, rows: 0 }),
            (sum, rows) => ({ files: sum.files + 1, rows: sum.rows + rows }),
          ),
        )
        yield* Effect.annotateCurrentSpan(pluginAttributes({ plugin: 'usage', attributes: { files: totals.files, rows: totals.rows } }))
        return totals
      })

      return SessionLogIndex.of({ indexFile, indexAll })
    }),
  )
}
