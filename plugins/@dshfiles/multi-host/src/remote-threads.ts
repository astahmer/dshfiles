import { Context, Effect, FileSystem, Layer, Option, Path, Schema, Semaphore } from 'effect'
import { MultiHostPaths } from './paths.js'
import { PrivateFile } from './private-file.js'
import { SchemaFields } from './schema.js'

/** A thread this manager started on another runtime: where it lives, so the local UI can list and reopen it. */
const remoteThreadSchema = Schema.Struct({
  runtimeId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  cwd: Schema.String.check(Schema.isMaxLength(4096)),
  title: Schema.String.check(Schema.isMaxLength(512)),
  createdAt: SchemaFields.dateTimeString,
})
const threadFileSchema = Schema.fromJsonString(
  Schema.Struct({ schemaVersion: Schema.Literal(1), threads: Schema.Array(remoteThreadSchema).check(Schema.isMaxLength(1000)) }),
)

export type RemoteThread = Schema.Schema.Type<typeof remoteThreadSchema>

const decodeThreadFile = Schema.decodeUnknownOption(threadFileSchema, { onExcessProperty: 'error' })
const decodeThread = Schema.decodeUnknownEffect(remoteThreadSchema, { onExcessProperty: 'error' })

/** The remote threads this manager started, kept in one private file; a damaged file reads as empty. */
export class RemoteThreads extends Context.Service<
  RemoteThreads,
  {
    readonly list: Effect.Effect<readonly RemoteThread[]>
    readonly record: (thread: RemoteThread) => Effect.Effect<RemoteThread>
    readonly forget: (match: { readonly runtimeId: string; readonly sessionId?: string | undefined }) => Effect.Effect<number>
  }
>()('@dshfiles/multi-host/RemoteThreads') {
  static readonly layer = Layer.effect(
    RemoteThreads,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const threadsPath = (yield* MultiHostPaths).dataPath('threads.json')
      const lock = yield* Semaphore.make(1)
      const provided = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
        effect.pipe(Effect.provideService(FileSystem.FileSystem, fileSystem), Effect.provideService(Path.Path, path))

      const readThreads = provided(PrivateFile.readIfPresent(threadsPath)).pipe(
        Effect.map(raw => (raw === undefined ? [] : Option.match(decodeThreadFile(raw), { onNone: () => [], onSome: file => [...file.threads] }))),
        Effect.orElseSucceed((): RemoteThread[] => []),
      )

      /** Ownership records are best effort: a failed write is logged and the change is lost, never the caller's work. */
      const update = <Result>(change: (threads: RemoteThread[]) => { readonly next: RemoteThread[]; readonly result: Result }) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const { next, result } = change(yield* readThreads)
            yield* provided(
              PrivateFile.write({
                path: threadsPath,
                body: `${JSON.stringify({ schemaVersion: 1, threads: next.slice(-1000) }, null, 2)}\n`,
                commit: 'rename',
              }),
            ).pipe(Effect.catchCause(cause => Effect.logWarning('multi-host could not save its remote thread list', cause)))
            return result
          }),
        )

      const record = Effect.fn('multi-host remote thread record')(function* (thread: RemoteThread) {
        const decoded = yield* decodeThread(thread).pipe(Effect.orDie)
        return yield* update(threads => ({
          next: [...threads.filter(item => !(item.runtimeId === decoded.runtimeId && item.sessionId === decoded.sessionId)), decoded],
          result: thread,
        }))
      })

      const forget = Effect.fn('multi-host remote thread forget')(function* (match: { readonly runtimeId: string; readonly sessionId?: string | undefined }) {
        return yield* update(threads => {
          const next = threads.filter(item => item.runtimeId !== match.runtimeId || (match.sessionId !== undefined && item.sessionId !== match.sessionId))
          return { next, result: threads.length - next.length }
        })
      })

      return RemoteThreads.of({ list: lock.withPermits(1)(readThreads), record, forget })
    }),
  )
}
