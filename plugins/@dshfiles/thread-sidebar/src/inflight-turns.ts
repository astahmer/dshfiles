import { join } from 'node:path'
import * as Schema from 'effect/Schema'
import * as Result from 'effect/Result'
import { dshHome } from './dsh-home.js'
import { JsonFile } from './json-file.js'
import { JsonText } from './json-text.js'
import type { RecoveryReason } from './restart-recovery.js'
import { SchemaHelpers } from './schema-helpers.js'

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256))
const MAX_INFLIGHT_TURNS = 5000

/** One turn this Host process opened and has not seen close. */
const inflightTurnSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    sessionId: sessionIdSchema,
    startedAt: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
  }),
)

const persistedInflightSchema = SchemaHelpers.strictStruct(
  Schema.Struct({ version: Schema.Literal(1), entries: Schema.Array(inflightTurnSchema).check(Schema.isMaxLength(MAX_INFLIGHT_TURNS)) }),
)

export type InflightTurn = Schema.Schema.Type<typeof inflightTurnSchema>

export interface InflightTurnStore {
  list(): Promise<InflightTurn[]>
  start(sessionId: string): Promise<void>
  /** Remove one turn and report whether this Host still had it open. */
  end(sessionId: string): Promise<boolean>
  /** Read the turns still in flight and clear the file, so one exit is promoted once. */
  take(): Promise<InflightTurn[]>
}

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

/**
 * A turn opens here, closes here, closes here because another process ended it first (`interrupted`), or is
 * cut off by this Host shutting down (`shutdown`: the loop ends it as aborted because its Agent was disposed).
 */
export type TurnBoundary = 'start' | 'end' | 'interrupted' | 'shutdown'

/** The recovery rows an in-flight promotion writes, kept structural so this module owns no store. */
interface RecoveryRecorder {
  record(sessionIds: readonly string[], reason: RecoveryReason): Promise<void>
}

/**
 * Classify one Session event as a turn boundary, ignoring every other event. An
 * `interrupted` ending is kept apart: crash recovery writes that reason for a turn
 * another process left open, so it still needs a resume row when its marker closes.
 */
const parseTurnBoundary = (event: unknown): TurnBoundary | null => {
  if (SchemaHelpers.decodeUnknownSafe(turnStartSchema, event).success) return 'start'
  const end = SchemaHelpers.decodeUnknownSafe(turnEndSchema, event)
  if (!end.success) return null
  const reason = end.data.data?.reason
  if (reason?.kind === 'interrupted') return 'interrupted'
  return reason?.kind === 'aborted' && reason.reason?.kind === 'disposed' ? 'shutdown' : 'end'
}

/**
 * The turns this Host process has open, durable enough to survive the process
 * itself: `turn/start` records one and `turn/end` removes it, so whatever the
 * next process finds here was interrupted by this one stopping.
 */
export class InflightTurns {
  static readonly filePath = (home?: string): string => join(dshHome(home), 'runtime', 'thread-sidebar-inflight-turns.json')

  static readonly boundaryFromEvent = parseTurnBoundary

  static readonly open = (options: { readonly home?: string; readonly now?: () => number } = {}): InflightTurnStore => {
    const path = InflightTurns.filePath(options.home)
    const now = options.now ?? Date.now
    const transact = JsonFile.transaction()

    const read = async (): Promise<InflightTurn[]> => {
      const contents = await JsonFile.readText({ path, missing: '{"version":1,"entries":[]}' })
      const parsed = JsonText.decodeEffect(persistedInflightSchema, contents)
      if (parsed === undefined || Result.isFailure(parsed)) throw new Error('In-flight turn state is invalid.')
      return [...parsed.success.entries]
    }

    const write = (entries: readonly InflightTurn[]): Promise<void> => JsonFile.write({ path, text: `${JSON.stringify({ version: 1, entries })}\n` })

    return {
      list: (): Promise<InflightTurn[]> => transact(read),
      start: (sessionId: string): Promise<void> =>
        transact(async () => {
          if (sessionId.length === 0 || sessionId.length > 256) return
          const entries = await read()
          if (entries.some(entry => entry.sessionId === sessionId)) return
          await write([...entries, { sessionId, startedAt: now() }].slice(-MAX_INFLIGHT_TURNS))
        }),
      end: (sessionId: string): Promise<boolean> =>
        transact(async () => {
          const entries = await read()
          const next = entries.filter(entry => entry.sessionId !== sessionId)
          if (next.length === entries.length) return false
          await write(next)
          return true
        }),
      take: (): Promise<InflightTurn[]> =>
        transact(async () => {
          const entries = await read()
          if (entries.length > 0) await write([])
          return entries
        }),
    }
  }

  /**
   * Promote every turn a previous Host process left open into the recovery
   * store, so a crash shows up in the thread list exactly like a managed
   * restart does. `take` clears the file before the promotion is recorded: a
   * failed record must not repeat the same rows on the next boot.
   */
  static readonly promote = async (options: {
    readonly inflight: Pick<InflightTurnStore, 'take'>
    readonly recovery: RecoveryRecorder
  }): Promise<readonly string[]> => {
    const entries = await options.inflight.take()
    if (entries.length === 0) return []
    const sessionIds = entries.map(entry => entry.sessionId)
    await options.recovery.record(sessionIds, 'interrupted')
    return sessionIds
  }
}
