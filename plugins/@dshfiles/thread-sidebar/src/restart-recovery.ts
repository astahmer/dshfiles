import { randomUUID } from 'node:crypto'
import { Clock, Context, Effect, Layer, Schema, Semaphore } from 'effect'
import { StateFiles } from './runtime-files.js'
import { RuntimeStateFailed, RuntimeStateInvalid } from './sidebar-errors.js'

/**
 * Why a thread needs a resume: `restart` is a managed restart that captured its
 * running Agents before exiting, `interrupted` is a turn that was still open
 * when a previous Host process stopped without that capture (a crash, a kill,
 * or a shutdown timeout).
 */
export type RecoveryReason = 'restart' | 'interrupted'

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256))
const MAX_RECOVERY_ENTRIES = 5000
const strict = { onExcessProperty: 'error' } as const

const legacyEntryFields = {
  sessionId: sessionIdSchema,
  requestId: Schema.String.check(Schema.isUUID()),
  interruptedAt: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
}

const recoveryEntrySchema = Schema.Struct({
  ...legacyEntryFields,
  reason: Schema.Literals(['restart', 'interrupted']).pipe(Schema.withDecodingDefaultKey(Effect.succeed('restart' as const))),
})

const persistedRecoverySchema = Schema.Struct({
  version: Schema.Literal(2),
  entries: Schema.Array(recoveryEntrySchema).check(Schema.isMaxLength(MAX_RECOVERY_ENTRIES)),
})

/** A v1 file predates the reason field, and every entry it holds came from a managed restart. */
const legacyRecoverySchema = Schema.Struct({
  version: Schema.Literal(1),
  entries: Schema.Array(Schema.Struct(legacyEntryFields)).check(Schema.isMaxLength(MAX_RECOVERY_ENTRIES)),
})

const decodeCurrent = Schema.decodeUnknownEffect(Schema.fromJsonString(persistedRecoverySchema))
const decodeLegacy = Schema.decodeUnknownEffect(Schema.fromJsonString(legacyRecoverySchema))

export type RestartRecoveryEntry = Schema.Schema.Type<typeof recoveryEntrySchema>

export const activeRestartSessionIds = (agents: readonly { readonly id: string; readonly status: string }[]): string[] => [
  ...new Set(agents.filter(agent => agent.status === 'running').map(agent => agent.id)),
]

export const RECOVERY_FILE = 'thread-sidebar-recoveries.json'

/**
 * Threads to resume after a restart or a crash, in `<DSH home>/runtime/thread-sidebar-recoveries.json`. Every
 * read-modify-write holds one permit, so two captures never drop each other's rows.
 */
export class RecoveryStore extends Context.Service<
  RecoveryStore,
  {
    readonly list: Effect.Effect<ReadonlyArray<RestartRecoveryEntry>, RuntimeStateFailed | RuntimeStateInvalid>
    readonly record: (input: {
      readonly sessionIds: readonly string[]
      readonly reason: RecoveryReason
    }) => Effect.Effect<void, RuntimeStateFailed | RuntimeStateInvalid>
    readonly remove: (sessionIds: ReadonlySet<string>) => Effect.Effect<void, RuntimeStateFailed | RuntimeStateInvalid>
  }
>()('@dshfiles/thread-sidebar/RecoveryStore') {
  static readonly layer = Layer.effect(
    RecoveryStore,
    Effect.gen(function* () {
      const files = yield* StateFiles
      const path = files.runtimePath(RECOVERY_FILE)
      const lock = yield* Semaphore.make(1)

      const read = Effect.gen(function* () {
        const contents = yield* files
          .read({ path, missing: '{"version":2,"entries":[]}' })
          .pipe(Effect.mapError(cause => new RuntimeStateFailed({ file: 'recoveries', operation: 'read', cause })))
        return yield* decodeCurrent(contents, strict).pipe(
          Effect.map((document): RestartRecoveryEntry[] => [...document.entries]),
          Effect.catch(() =>
            decodeLegacy(contents, strict).pipe(Effect.map(document => document.entries.map(entry => ({ ...entry, reason: 'restart' as const })))),
          ),
          Effect.mapError(cause => new RuntimeStateInvalid({ file: 'recoveries', cause })),
        )
      })

      const write = (entries: readonly RestartRecoveryEntry[]) =>
        files
          .write({ path, text: `${JSON.stringify({ version: 2, entries })}\n` })
          .pipe(Effect.mapError(cause => new RuntimeStateFailed({ file: 'recoveries', operation: 'write', cause })))

      const exclusive = lock.withPermits(1)

      return RecoveryStore.of({
        list: exclusive(read).pipe(Effect.withSpan('recovery list')),
        record: Effect.fn('recovery record')(function* (input) {
          yield* exclusive(
            Effect.gen(function* () {
              const entries = yield* read
              const known = new Set(entries.map(entry => entry.sessionId))
              const now = yield* Clock.currentTimeMillis
              const added = [...new Set(input.sessionIds)]
                .filter(sessionId => sessionId.length > 0 && sessionId.length <= 256 && !known.has(sessionId))
                .map(sessionId => ({ sessionId, requestId: randomUUID(), interruptedAt: now, reason: input.reason }))
              if (added.length > 0) yield* write([...entries, ...added].slice(-MAX_RECOVERY_ENTRIES))
            }),
          )
        }),
        remove: Effect.fn('recovery remove')(function* (sessionIds) {
          yield* exclusive(
            Effect.gen(function* () {
              const entries = yield* read
              const next = entries.filter(entry => !sessionIds.has(entry.sessionId))
              if (next.length !== entries.length) yield* write(next)
            }),
          )
        }),
      })
    }),
  )
}
