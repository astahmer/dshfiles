import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { Context, Effect, Layer, SynchronizedRef } from 'effect'
import {
  failedTurnSchema,
  FAILED_FINISH_REASONS,
  MAX_ATTENTION_SESSIONS,
  type AttentionFinishReason,
  type FailedFinishReason,
  type FailedTurn,
} from './attention-api.js'
import { AttentionStorageFailed } from './sidebar-errors.js'

export const failedTurnsDomain = defineDomain({
  name: 'thread_failed_turns',
  version: 1,
  // One document per failed thread: a later finish touches its own row.
  layout: 'per-record',
  tables: {
    sessions: { valueSchema: zodSchemaFromEffect(failedTurnSchema), __key: 'sessions' },
  },
})

const isFailedReason = (reason: AttentionFinishReason): reason is FailedFinishReason => FAILED_FINISH_REASONS.some(failed => failed === reason)

/** The record one finished turn leaves: its failure, or nothing (a later turn that did not fail clears the thread). */
const recordOf = (input: { readonly sessionId: string; readonly time: number; readonly reason: AttentionFinishReason }): FailedTurn | null =>
  isFailedReason(input.reason) ? { sessionId: input.sessionId, failedAt: input.time, reason: input.reason } : null

/** Keys to drop once the store exceeds its bound; the oldest failures go first. */
const keysToTrim = (records: readonly FailedTurn[], limit = MAX_ATTENTION_SESSIONS): readonly string[] =>
  [...records]
    .sort((left, right) => left.failedAt - right.failedAt)
    .slice(0, Math.max(0, records.length - limit))
    .map(record => record.sessionId)

/** Newest failure first: the order every read lists them in. */
const listOf = (records: ReadonlyMap<string, FailedTurn>): readonly FailedTurn[] => [...records.values()].sort((left, right) => right.failedAt - left.failedAt)

export class FailedTurnsModel {
  static readonly recordOf = recordOf
  static readonly keysToTrim = keysToTrim
}

/**
 * Threads whose last finished turn failed, in the `thread_failed_turns` storage domain. Unlike the attention record
 * (dropped when the thread is opened), this one stays until a later turn of the thread finishes without failing: a
 * failed thread reads Failed in every list until it is retried, whether or not anyone looked at it.
 */
export class FailedTurns extends Context.Service<
  FailedTurns,
  {
    readonly list: Effect.Effect<readonly FailedTurn[]>
    /** Record one finished turn; resolves to whether the thread's failed state changed. */
    readonly record: (input: {
      readonly sessionId: string
      readonly time: number
      readonly reason: AttentionFinishReason
    }) => Effect.Effect<boolean, AttentionStorageFailed>
    /** Forget a thread's failure (the user marked its inbox item Done); resolves to whether it was failed. */
    readonly clear: (sessionId: string) => Effect.Effect<boolean, AttentionStorageFailed>
  }
>()('@dshfiles/thread-sidebar/FailedTurns') {
  static readonly layer = Layer.effect(
    FailedTurns,
    Effect.gen(function* () {
      const domain = yield* (yield* StorageDomain)
        .open(failedTurnsDomain)
        .pipe(Effect.mapError(cause => new AttentionStorageFailed({ operation: 'open', cause })))
      const table = domain.table('sessions')
      const stored = yield* table.entries.pipe(Effect.mapError(cause => new AttentionStorageFailed({ operation: 'open', cause })))
      const state = yield* SynchronizedRef.make<ReadonlyMap<string, FailedTurn>>(new Map(stored))

      return FailedTurns.of({
        list: Effect.map(SynchronizedRef.get(state), listOf),
        record: Effect.fn('thread failed turn record')(function* (input) {
          return yield* SynchronizedRef.modifyEffect(state, current =>
            Effect.gen(function* () {
              const record = recordOf(input)
              if (record === null) {
                if (!current.has(input.sessionId)) return [false, current] as const
                yield* table.delete(input.sessionId)
                const next = new Map(current)
                next.delete(input.sessionId)
                return [true, next] as const
              }
              yield* table.put(record.sessionId, record)
              const next = new Map(current).set(record.sessionId, record)
              const trimmed = keysToTrim([...next.values()])
              yield* Effect.forEach(trimmed, sessionId => table.delete(sessionId), { discard: true })
              for (const sessionId of trimmed) next.delete(sessionId)
              return [true, next] as const
            }).pipe(Effect.mapError(cause => new AttentionStorageFailed({ operation: 'record', cause }))),
          )
        }),
        clear: Effect.fn('thread failed turn clear')(function* (sessionId) {
          return yield* SynchronizedRef.modifyEffect(state, current =>
            Effect.gen(function* () {
              if (!current.has(sessionId)) return [false, current] as const
              yield* table.delete(sessionId)
              const next = new Map(current)
              next.delete(sessionId)
              return [true, next] as const
            }).pipe(Effect.mapError(cause => new AttentionStorageFailed({ operation: 'record', cause }))),
          )
        }),
      })
    }),
  )
}
