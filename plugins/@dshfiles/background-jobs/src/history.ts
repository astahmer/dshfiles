import { pluginAttributes } from '@dshfiles/dshx/tracing'
import { type LogChunk, type LogRecord, readLogFrom } from '@dshfiles/usage/session-log'
import { Clock, Context, Effect, FileSystem, Layer, Option, Path, Ref, Schema, Semaphore, Stream, SubscriptionRef } from 'effect'
import { boundedLabel } from './bounds.js'
import { HistoryPersistFailed } from './errors.js'
import { type HistoryJob, type JobIndexing, type JobSession, jobStateSchema } from './types.js'

/**
 * Durable index of the jobs every Session log recorded. The Host only knows the
 * jobs of its own process, so the log is the one source that still lists what
 * earlier DSH processes ran. One pass reads a bounded number of changed files,
 * resuming each at the byte offset of its last complete frame.
 */

const DIRECTORY_CONCURRENCY = 16
const MAX_ERROR_LENGTH = 500

const nonemptyString = Schema.String.check(Schema.isMinLength(1))
const nonnegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const decodeHeader = Schema.decodeUnknownOption(Schema.Struct({ id: nonemptyString, cwd: Schema.optional(nonemptyString) }))
const decodeTitle = Schema.decodeUnknownOption(Schema.Struct({ title: nonemptyString }))
const decodeRegistered = Schema.decodeUnknownOption(
  Schema.Struct({
    jobId: nonemptyString,
    owner: Schema.optional(nonemptyString),
    kind: nonemptyString,
    label: Schema.String,
    startedAt: nonnegativeInteger,
  }),
)
const decodeSettled = Schema.decodeUnknownOption(
  Schema.Struct({
    jobId: nonemptyString,
    owner: Schema.optional(nonemptyString),
    kind: nonemptyString,
    label: Schema.String,
    startedAt: nonnegativeInteger,
    finishedAt: nonnegativeInteger,
    status: Schema.Literals(['completed', 'killed', 'failed']),
    cause: nonemptyString,
    detail: Schema.optional(Schema.String),
  }),
)
const stateJson = Schema.fromJsonString(jobStateSchema)
const decodeState = Schema.decodeUnknownEffect(stateJson, { onExcessProperty: 'error' })
const encodeState = Schema.encodeEffect(stateJson)

export class HistoryConfig extends Context.Service<
  HistoryConfig,
  {
    readonly root: string
    readonly statePath: string
    readonly maxJobs: number
    readonly filesPerPass: number
    readonly budgetMs: number
  }
>()('@dshfiles/background-jobs/HistoryConfig') {
  static readonly layer = (input: {
    readonly root: string
    readonly statePath: string
    readonly maxJobs?: number
    readonly filesPerPass?: number
    readonly budgetMs?: number
  }) =>
    Layer.succeed(
      HistoryConfig,
      HistoryConfig.of({
        root: input.root,
        statePath: input.statePath,
        maxJobs: input.maxJobs ?? 20_000,
        filesPerPass: input.filesPerPass ?? 40,
        budgetMs: input.budgetMs ?? 2_000,
      }),
    )
}

export interface HistorySnapshot {
  readonly jobs: ReadonlyMap<string, HistoryJob>
  readonly sessions: ReadonlyMap<string, JobSession>
  readonly indexing: JobIndexing
}

interface LogFile {
  readonly path: string
  readonly project: string
  readonly size: number
  readonly mtimeMs: number
}

interface WorkingIndex {
  readonly offsets: Map<string, number>
  readonly jobs: Map<string, HistoryJob>
  readonly sessions: Map<string, JobSession>
}

const sessionIdOf = (directory: string): string => (directory.startsWith('session-') ? directory : `session-${directory}`)

const ingest = (input: { readonly index: WorkingIndex; readonly record: LogRecord; readonly file: LogFile; readonly sessionId: string }): void => {
  const { index, record, file, sessionId } = input
  if (record.type === 'session') {
    Option.map(decodeHeader(record.data), header => {
      const previous = index.sessions.get(header.id)
      index.sessions.set(header.id, { id: header.id, title: previous?.title ?? null, cwd: header.cwd ?? previous?.cwd ?? null, project: file.project })
    })
    return
  }
  if (record.type === 'session/title') {
    Option.map(decodeTitle(record.data), title => {
      const previous = index.sessions.get(sessionId)
      index.sessions.set(sessionId, { id: sessionId, title: title.title.slice(0, 300), cwd: previous?.cwd ?? null, project: previous?.project ?? file.project })
    })
    return
  }
  if (record.type === 'job/registered') {
    Option.map(decodeRegistered(record.data), job =>
      index.jobs.set(job.jobId, {
        id: job.jobId,
        kind: job.kind,
        label: boundedLabel(job.label),
        owner: job.owner ?? null,
        startedAt: job.startedAt,
        settled: false,
        status: null,
        cause: null,
        detail: null,
        finishedAt: null,
      }),
    )
    return
  }
  if (record.type !== 'job/settled') return
  Option.map(decodeSettled(record.data), job => {
    const previous = index.jobs.get(job.jobId)
    index.jobs.set(job.jobId, {
      id: job.jobId,
      kind: job.kind,
      label: boundedLabel(job.label),
      owner: job.owner ?? previous?.owner ?? null,
      startedAt: job.startedAt,
      settled: true,
      status: job.status,
      cause: job.cause,
      detail: job.detail ?? null,
      finishedAt: job.finishedAt,
    })
  })
}

const trim = (input: { readonly jobs: Map<string, HistoryJob>; readonly maxJobs: number }): void => {
  if (input.jobs.size <= input.maxJobs) return
  const oldest = [...input.jobs.values()].sort((left, right) => left.startedAt - right.startedAt).slice(0, input.jobs.size - input.maxJobs)
  for (const job of oldest) input.jobs.delete(job.id)
}

const boundedError = (error: { readonly message: string }): string => error.message.slice(0, MAX_ERROR_LENGTH)

export class HistoryIndex extends Context.Service<
  HistoryIndex,
  {
    readonly snapshot: Effect.Effect<HistorySnapshot>
    /** The current snapshot, then every snapshot a pass publishes. */
    readonly changes: Stream.Stream<HistorySnapshot>
    /** Index what the logs gained; a pass already running finishes first, so the result is at least as fresh as the call. */
    readonly pass: Effect.Effect<JobIndexing>
  }
>()('@dshfiles/background-jobs/HistoryIndex') {
  static readonly layer = Layer.effect(
    HistoryIndex,
    Effect.gen(function* () {
      const config = yield* HistoryConfig
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const startedAt = yield* Clock.currentTimeMillis
      const offsets = yield* Ref.make<ReadonlyMap<string, number>>(new Map())
      const state = yield* SubscriptionRef.make<HistorySnapshot>({
        jobs: new Map(),
        sessions: new Map(),
        indexing: { active: false, caughtUp: false, files: 0, indexedFiles: 0, historyRows: 0, lastIndexedAt: null, lastError: null },
      })
      const permit = yield* Semaphore.make(1)

      const load = yield* Effect.cached(
        fileSystem.readFileString(config.statePath).pipe(
          Effect.flatMap(decodeState),
          Effect.flatMap(saved =>
            Effect.all([
              Ref.set(offsets, new Map(Object.entries(saved.offsets))),
              SubscriptionRef.update(state, current => ({
                ...current,
                jobs: new Map(Object.entries(saved.jobs)),
                sessions: new Map(Object.entries(saved.sessions)),
              })),
            ]),
          ),
          Effect.catchTags({
            PlatformError: error => Effect.logDebug('background-jobs: no job history index yet; rescanning the logs', error.reason._tag),
            SchemaError: error => Effect.logWarning('background-jobs: ignoring an unreadable job history index; rescanning the logs', error.message),
          }),
        ),
      )

      const directories = (directory: string) =>
        fileSystem.readDirectoryEntries(directory).pipe(
          Effect.map(entries => entries.filter(entry => entry.type === 'Directory').map(entry => entry.name)),
          Effect.orElseSucceed((): ReadonlyArray<string> => []),
        )

      const logFile = (input: { readonly project: string; readonly sessionDirectory: string; readonly name: string }) => {
        const filePath = path.join(input.sessionDirectory, input.name)
        return fileSystem.stat(filePath).pipe(
          Effect.map(info =>
            info.type === 'File'
              ? Option.some<LogFile>({
                  path: filePath,
                  project: input.project,
                  size: Number(info.size),
                  mtimeMs: Option.match(info.mtime, { onNone: () => 0, onSome: date => date.getTime() }),
                })
              : Option.none(),
          ),
          Effect.orElseSucceed(() => Option.none<LogFile>()),
        )
      }

      const listFiles = Effect.gen(function* () {
        const projects = yield* directories(config.root)
        const sessionDirectories = (yield* Effect.forEach(
          projects,
          project =>
            Effect.map(directories(path.join(config.root, project)), sessions =>
              sessions.map(session => ({ project, sessionDirectory: path.join(config.root, project, session) })),
            ),
          { concurrency: DIRECTORY_CONCURRENCY },
        )).flat()
        const files = yield* Effect.forEach(
          sessionDirectories,
          directory =>
            fileSystem.readDirectory(directory.sessionDirectory).pipe(
              Effect.orElseSucceed((): ReadonlyArray<string> => []),
              Effect.flatMap(names =>
                Effect.forEach(
                  names.filter(name => name.includes('.jsonl')),
                  name => logFile({ ...directory, name }),
                ),
              ),
            ),
          { concurrency: DIRECTORY_CONCURRENCY },
        )
        return files
          .flat()
          .flatMap(file => Option.toArray(file))
          .sort((left, right) => right.mtimeMs - left.mtimeMs)
      })

      const persist = Effect.fn('background-jobs history persist')(function* (input: { readonly index: WorkingIndex }) {
        const failed = (cause: unknown) => new HistoryPersistFailed({ path: config.statePath, cause })
        const text = yield* encodeState({
          schemaVersion: 1,
          offsets: Object.fromEntries(input.index.offsets),
          jobs: Object.fromEntries(input.index.jobs),
          sessions: Object.fromEntries(input.index.sessions),
          startedAt,
        }).pipe(Effect.mapError(failed))
        const temporary = `${config.statePath}.${String(process.pid)}.tmp`
        yield* fileSystem
          .makeDirectory(path.dirname(config.statePath), { recursive: true })
          .pipe(
            Effect.andThen(fileSystem.writeFileString(temporary, text, { mode: 0o600 })),
            Effect.andThen(fileSystem.rename(temporary, config.statePath)),
            Effect.mapError(failed),
          )
      })

      const runPass = Effect.fn('background-jobs history pass')(function* () {
        yield* load
        yield* SubscriptionRef.update(state, current => ({ ...current, indexing: { ...current.indexing, active: true } }))
        const passStartedAt = yield* Clock.currentTimeMillis
        const current = yield* SubscriptionRef.get(state)
        const index: WorkingIndex = { offsets: new Map(yield* Ref.get(offsets)), jobs: new Map(current.jobs), sessions: new Map(current.sessions) }
        const files = yield* listFiles
        const failures: string[] = []
        let read = 0
        yield* Effect.forEach(
          files,
          Effect.fnUntraced(function* (file) {
            if (read >= config.filesPerPass || file.size <= (index.offsets.get(file.path) ?? 0)) return
            if ((yield* Clock.currentTimeMillis) - passStartedAt > config.budgetMs) return
            read += 1
            const chunk = yield* readLogFrom({ path: file.path, fromOffset: index.offsets.get(file.path) ?? 0, size: file.size }).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.map(Option.some),
              Effect.catchTag('SessionLogReadFailed', error =>
                Effect.sync(() => {
                  failures.push(boundedError(error))
                  return Option.none<LogChunk>()
                }),
              ),
            )
            if (Option.isNone(chunk)) return
            index.offsets.set(file.path, chunk.value.endOffset)
            const sessionId = sessionIdOf(path.basename(path.dirname(file.path)))
            for (const record of chunk.value.records) ingest({ index, record, file, sessionId })
            trim({ jobs: index.jobs, maxJobs: config.maxJobs })
          }),
          { discard: true },
        )
        const caughtUp = read < config.filesPerPass
        yield* Effect.annotateCurrentSpan(
          pluginAttributes({ plugin: 'background-jobs', attributes: { files: files.length, read_files: read, caught_up: caughtUp } }),
        )
        const persisted =
          read > 0
            ? yield* persist({ index }).pipe(
                Effect.as(Option.none<string>()),
                Effect.catchTag('HistoryPersistFailed', error => Effect.succeed(Option.some(boundedError(error)))),
              )
            : Option.none<string>()
        const lastError = Option.orElse(persisted, () => Option.fromUndefinedOr(failures.at(-1)))
        const finishedAt = yield* Clock.currentTimeMillis
        yield* Ref.set(offsets, index.offsets)
        yield* SubscriptionRef.set(state, {
          jobs: index.jobs,
          sessions: index.sessions,
          indexing: {
            active: false,
            caughtUp,
            files: files.length,
            indexedFiles: index.offsets.size,
            historyRows: index.jobs.size,
            lastIndexedAt: Option.isNone(lastError) ? finishedAt : current.indexing.lastIndexedAt,
            lastError: Option.getOrNull(lastError),
          },
        })
      })

      return HistoryIndex.of({
        snapshot: SubscriptionRef.get(state),
        changes: SubscriptionRef.changes(state),
        pass: permit.withPermit(runPass()).pipe(
          Effect.andThen(SubscriptionRef.get(state)),
          Effect.map(snapshot => snapshot.indexing),
        ),
      })
    }),
  )
}
