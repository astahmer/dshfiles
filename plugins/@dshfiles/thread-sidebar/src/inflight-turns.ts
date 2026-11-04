import { Clock, Context, Effect, Layer, Option, Schema, Semaphore } from 'effect'
import { RecoveryStore } from './restart-recovery.js'
import { StateFiles } from './runtime-files.js'
import { RuntimeStateFailed, RuntimeStateInvalid } from './sidebar-errors.js'

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256))
const MAX_INFLIGHT_TURNS = 5000
const strict = { onExcessProperty: 'error' } as const

/** One turn this Host process opened and has not seen close. */
const inflightTurnSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  startedAt: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
})

const persistedInflightSchema = Schema.Struct({
  version: Schema.Literal(1),
  entries: Schema.Array(inflightTurnSchema).check(Schema.isMaxLength(MAX_INFLIGHT_TURNS)),
})

const decodeInflight = Schema.decodeUnknownEffect(Schema.fromJsonString(persistedInflightSchema))

export type InflightTurn = Schema.Schema.Type<typeof inflightTurnSchema>

const turnStartSchema = Schema.Struct({ type: Schema.Literal('turn/start') })

const turnEndSchema = Schema.Struct({
  type: Schema.Literal('turn/end'),
  data: Schema.optional(
    Schema.Struct({
      reason: Schema.optional(
        Schema.Struct({
          kind: Schema.String.check(Schema.isMaxLength(64)),
          reason: Schema.optional(Schema.Struct({ kind: Schema.String.check(Schema.isMaxLength(64)) })),
        }),
      ),
    }),
  ),
})

const isTurnStart = Schema.is(turnStartSchema)
const decodeTurnEnd = Schema.decodeUnknownOption(turnEndSchema)

/**
 * A turn opens here, closes here, closes here because another process ended it first (`interrupted`), or is
 * cut off by this Host shutting down (`shutdown`: the loop ends it as aborted because its Agent was disposed).
 */
export type TurnBoundary = 'start' | 'end' | 'interrupted' | 'shutdown'

/**
 * Classify one Session event as a turn boundary, ignoring every other event. An
 * `interrupted` ending is kept apart: crash recovery writes that reason for a turn
 * another process left open, so it still needs a resume row when its marker closes.
 */
export const turnBoundaryFromEvent = (event: unknown): TurnBoundary | null => {
  if (isTurnStart(event)) return 'start'
  const end = decodeTurnEnd(event)
  if (Option.isNone(end)) return null
  const reason = end.value.data?.reason
  if (reason?.kind === 'interrupted') return 'interrupted'
  return reason?.kind === 'aborted' && reason.reason?.kind === 'disposed' ? 'shutdown' : 'end'
}

export const INFLIGHT_FILE = 'thread-sidebar-inflight-turns.json'

type InflightError = RuntimeStateFailed | RuntimeStateInvalid

/**
 * The turns this Host process has open, durable enough to survive the process
 * itself: `turn/start` records one and `turn/end` removes it, so whatever the
 * next process finds here was interrupted by this one stopping.
 */
export class InflightTurns extends Context.Service<
  InflightTurns,
  {
    readonly list: Effect.Effect<ReadonlyArray<InflightTurn>, InflightError>
    readonly start: (sessionId: string) => Effect.Effect<void, InflightError>
    /** Remove one turn and report whether this Host still had it open. */
    readonly end: (sessionId: string) => Effect.Effect<boolean, InflightError>
    /**
     * Promote every turn a previous Host process left open into the recovery store, so a crash shows up in the
     * thread list exactly like a managed restart does. The file is cleared before the promotion is recorded: a
     * failed record must not repeat the same rows on the next boot.
     */
    readonly promote: Effect.Effect<ReadonlyArray<string>, InflightError>
  }
>()('@dshfiles/thread-sidebar/InflightTurns') {
  static readonly layer = Layer.effect(
    InflightTurns,
    Effect.gen(function* () {
      const files = yield* StateFiles
      const recovery = yield* RecoveryStore
      const path = files.runtimePath(INFLIGHT_FILE)
      const exclusive = (yield* Semaphore.make(1)).withPermits(1)

      const read = files.read({ path, missing: '{"version":1,"entries":[]}' }).pipe(
        Effect.mapError(cause => new RuntimeStateFailed({ file: 'inflight-turns', operation: 'read', cause })),
        Effect.flatMap(contents => decodeInflight(contents, strict).pipe(Effect.mapError(cause => new RuntimeStateInvalid({ file: 'inflight-turns', cause })))),
        Effect.map(document => [...document.entries]),
      )

      const write = (entries: readonly InflightTurn[]) =>
        files
          .write({ path, text: `${JSON.stringify({ version: 1, entries })}\n` })
          .pipe(Effect.mapError(cause => new RuntimeStateFailed({ file: 'inflight-turns', operation: 'write', cause })))

      const take = exclusive(
        Effect.gen(function* () {
          const entries = yield* read
          if (entries.length > 0) yield* write([])
          return entries
        }),
      )

      return InflightTurns.of({
        list: exclusive(read),
        start: Effect.fn('inflight turn start')(function* (sessionId) {
          if (sessionId.length === 0 || sessionId.length > 256) return
          yield* exclusive(
            Effect.gen(function* () {
              const entries = yield* read
              if (entries.some(entry => entry.sessionId === sessionId)) return
              const startedAt = yield* Clock.currentTimeMillis
              yield* write([...entries, { sessionId, startedAt }].slice(-MAX_INFLIGHT_TURNS))
            }),
          )
        }),
        end: Effect.fn('inflight turn end')(function* (sessionId) {
          return yield* exclusive(
            Effect.gen(function* () {
              const entries = yield* read
              const next = entries.filter(entry => entry.sessionId !== sessionId)
              if (next.length === entries.length) return false
              yield* write(next)
              return true
            }),
          )
        }),
        promote: Effect.gen(function* () {
          const entries = yield* take
          if (entries.length === 0) return []
          const sessionIds = entries.map(entry => entry.sessionId)
          yield* recovery.record({ sessionIds, reason: 'interrupted' })
          return sessionIds
        }).pipe(Effect.withSpan('inflight turns promote')),
      })
    }),
  )
}
