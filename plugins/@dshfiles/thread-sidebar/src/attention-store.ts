import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { Clock, Context, Effect, Layer, Option, Schema, SynchronizedRef } from 'effect'
import {
  MAX_ATTENTION_SESSIONS,
  threadAttentionViewSchema,
  type AttentionFinishReason,
  type ThreadAttentionMigrationEntry,
  type ThreadAttentionSnapshot,
  type ThreadAttentionView,
} from './attention-api.js'
import { AttentionStorageFailed } from './sidebar-errors.js'

export const threadAttentionDomain = defineDomain({
  name: 'thread_attention',
  version: 1,
  tables: {
    sessions: { valueSchema: zodSchemaFromEffect(threadAttentionViewSchema), __key: 'sessions' },
  },
})

const turnEndEventSchema = Schema.Struct({
  type: Schema.Literal('turn/end'),
  data: Schema.Struct({
    reason: Schema.Struct({
      kind: Schema.String.check(Schema.isMaxLength(64)),
      reason: Schema.optional(Schema.Struct({ kind: Schema.String.check(Schema.isMaxLength(64)) })),
    }),
  }),
})

const decodeTurnEnd = Schema.decodeUnknownOption(turnEndEventSchema)

/**
 * Turn ends that ask the user for something. `forked` closes a fork's
 * bookkeeping and `interrupted` continues in the next turn, so neither is a
 * completion to review.
 */
const finishReasonByKind: Readonly<Record<string, AttentionFinishReason>> = {
  completed: 'completed',
  aborted: 'aborted',
  blocked: 'blocked',
  error: 'error',
  'max-tokens': 'max-tokens',
}

const finishReasonFromEvent = (event: unknown): AttentionFinishReason | null => {
  const parsed = decodeTurnEnd(event)
  if (Option.isNone(parsed)) return null
  const reason = parsed.value.data.reason
  // The Host shutting down disposes a running Agent: that turn resumes after the restart, it was not stopped by anyone.
  if (reason.kind === 'aborted' && reason.reason?.kind === 'disposed') return null
  return finishReasonByKind[reason.kind] ?? null
}

/** Monotone across Host restarts: a new record always outranks every stored version. */
const nextAttentionVersion = (current: number, now: number): number => Math.max(current + 1, now)

const byVersionAscending = (left: ThreadAttentionView, right: ThreadAttentionView): number => left.version - right.version

/** Keys to drop once the store exceeds its bound; the least recently written records go first. */
const attentionKeysToTrim = (records: readonly ThreadAttentionView[], limit = MAX_ATTENTION_SESSIONS): readonly string[] =>
  [...records]
    .sort(byVersionAscending)
    .slice(0, Math.max(0, records.length - limit))
    .map(record => record.sessionId)

const legacyAttentionRecord = (entry: ThreadAttentionMigrationEntry, version: number): ThreadAttentionView | null =>
  entry.finishedAt === null && !entry.manuallyUnread
    ? null
    : {
        sessionId: entry.sessionId,
        version,
        finishedAt: entry.finishedAt,
        finishedSeq: null,
        finishedReason: null,
        manuallyUnread: entry.manuallyUnread,
      }

export class ThreadAttentionStoreModel {
  static readonly finishReasonFromEvent = finishReasonFromEvent
  static readonly nextVersion = nextAttentionVersion
  static readonly keysToTrim = attentionKeysToTrim
  static readonly legacyRecord = legacyAttentionRecord
}

interface AttentionState {
  readonly records: ReadonlyMap<string, ThreadAttentionView>
  readonly revision: number
}

/** What one change does: rows to put and keys to delete, applied durably before the mirror moves. */
interface AttentionChange {
  readonly put: readonly ThreadAttentionView[]
  readonly remove: readonly string[]
}

type Operation = AttentionStorageFailed['operation']

const snapshotOf = (state: AttentionState): ThreadAttentionSnapshot => ({
  revision: state.revision,
  sessions: [...state.records.values()].sort((left, right) => (right.finishedAt ?? 0) - (left.finishedAt ?? 0) || byVersionAscending(left, right)),
})

/**
 * The Host's durable record of threads the user has not acknowledged, in the `thread_attention` storage domain. Only
 * unacknowledged threads are stored, so acknowledging deletes a row instead of keeping a comparison value that could
 * drift from the Session log. Every change writes durably first, then moves the in-memory mirror reads answer from.
 */
export class ThreadAttention extends Context.Service<
  ThreadAttention,
  {
    readonly snapshot: Effect.Effect<ThreadAttentionSnapshot>
    readonly recordFinish: (input: {
      readonly sessionId: string
      readonly seq: number
      readonly time: number
      readonly reason: AttentionFinishReason
    }) => Effect.Effect<void, AttentionStorageFailed>
    readonly acknowledge: (input: { readonly sessionId: string; readonly version: number }) => Effect.Effect<ThreadAttentionSnapshot, AttentionStorageFailed>
    readonly clearUnread: (input: { readonly sessionId: string; readonly version: number }) => Effect.Effect<ThreadAttentionSnapshot, AttentionStorageFailed>
    readonly clearUnreadMany: (
      entries: ReadonlyArray<{ readonly sessionId: string; readonly version: number }>,
    ) => Effect.Effect<ThreadAttentionSnapshot, AttentionStorageFailed>
    readonly markUnread: (input: { readonly sessionId: string }) => Effect.Effect<ThreadAttentionSnapshot, AttentionStorageFailed>
    readonly markUnreadMany: (sessionIds: ReadonlyArray<string>) => Effect.Effect<ThreadAttentionSnapshot, AttentionStorageFailed>
    readonly migrate: (entries: ReadonlyArray<ThreadAttentionMigrationEntry>) => Effect.Effect<ThreadAttentionSnapshot, AttentionStorageFailed>
  }
>()('@dshfiles/thread-sidebar/ThreadAttention') {
  static readonly layer = Layer.effect(
    ThreadAttention,
    Effect.gen(function* () {
      const domain = yield* (yield* StorageDomain)
        .open(threadAttentionDomain)
        .pipe(Effect.mapError(cause => new AttentionStorageFailed({ operation: 'open', cause })))
      const table = domain.table('sessions')
      const stored = yield* table.entries.pipe(Effect.mapError(cause => new AttentionStorageFailed({ operation: 'open', cause })))
      const now = yield* Clock.currentTimeMillis
      const state = yield* SynchronizedRef.make<AttentionState>({
        records: new Map(stored),
        revision: Math.max(now, ...stored.map(([, record]) => record.version)),
      })

      /** Run one change under the mirror's lock: plan it against the current records, write it, then publish it. */
      const apply = (operation: Operation, plan: (records: ReadonlyMap<string, ThreadAttentionView>, takeVersion: () => number) => AttentionChange) =>
        SynchronizedRef.modifyEffect(state, current =>
          Effect.gen(function* () {
            const at = yield* Clock.currentTimeMillis
            let revision = current.revision
            const takeVersion = (): number => {
              revision = nextAttentionVersion(revision, at)
              return revision
            }
            const change = plan(current.records, takeVersion)
            const records = new Map(current.records)
            for (const sessionId of change.remove) records.delete(sessionId)
            for (const record of change.put) records.set(record.sessionId, record)
            const trimmed = attentionKeysToTrim([...records.values()])
            for (const sessionId of trimmed) records.delete(sessionId)
            const puts = change.put.filter(record => records.has(record.sessionId))
            yield* Effect.forEach(puts, record => table.put(record.sessionId, record), { discard: true })
            yield* Effect.forEach([...change.remove, ...trimmed], sessionId => table.delete(sessionId), { discard: true })
            const next = { records, revision }
            return [snapshotOf(next), next] as const
          }).pipe(Effect.mapError(cause => new AttentionStorageFailed({ operation, cause }))),
        )

      const unchanged: AttentionChange = { put: [], remove: [] }

      return ThreadAttention.of({
        snapshot: Effect.map(SynchronizedRef.get(state), snapshotOf),
        recordFinish: Effect.fn('thread attention record')(function* (input) {
          yield* apply('record', (records, takeVersion) => ({
            put: [
              {
                sessionId: input.sessionId,
                version: takeVersion(),
                finishedAt: input.time,
                finishedSeq: input.seq,
                finishedReason: input.reason,
                manuallyUnread: records.get(input.sessionId)?.manuallyUnread ?? false,
              },
            ],
            remove: [],
          }))
        }),
        acknowledge: Effect.fn('thread attention acknowledge')(function* (input) {
          return yield* apply('acknowledge', (records, takeVersion) => {
            const record = records.get(input.sessionId)
            if (record === undefined || record.version > input.version) return unchanged
            if (!record.manuallyUnread) return { put: [], remove: [input.sessionId] }
            return {
              put: [{ sessionId: input.sessionId, version: takeVersion(), finishedAt: null, finishedSeq: null, finishedReason: null, manuallyUnread: true }],
              remove: [],
            }
          })
        }),
        clearUnread: Effect.fn('thread attention clear')(function* (input) {
          return yield* apply('clear', records => {
            const record = records.get(input.sessionId)
            return record === undefined || record.version > input.version ? unchanged : { put: [], remove: [input.sessionId] }
          })
        }),
        clearUnreadMany: Effect.fn('thread attention clear many')(function* (entries) {
          return yield* apply('clear', records => ({
            put: [],
            remove: entries.flatMap(entry => {
              const record = records.get(entry.sessionId)
              return record === undefined || record.version > entry.version ? [] : [entry.sessionId]
            }),
          }))
        }),
        markUnread: Effect.fn('thread attention mark')(function* (input) {
          return yield* apply('mark', (records, takeVersion) => {
            const existing = records.get(input.sessionId)
            return {
              put: [
                {
                  sessionId: input.sessionId,
                  version: takeVersion(),
                  finishedAt: existing?.finishedAt ?? null,
                  finishedSeq: existing?.finishedSeq ?? null,
                  finishedReason: existing?.finishedReason ?? null,
                  manuallyUnread: true,
                },
              ],
              remove: [],
            }
          })
        }),
        markUnreadMany: Effect.fn('thread attention mark many')(function* (sessionIds) {
          return yield* apply('mark', (records, takeVersion) => ({
            put: sessionIds.map(sessionId => {
              const existing = records.get(sessionId)
              return {
                sessionId,
                version: takeVersion(),
                finishedAt: existing?.finishedAt ?? null,
                finishedSeq: existing?.finishedSeq ?? null,
                finishedReason: existing?.finishedReason ?? null,
                manuallyUnread: true,
              }
            }),
            remove: [],
          }))
        }),
        migrate: Effect.fn('thread attention migrate')(function* (entries) {
          return yield* apply('migrate', (records, takeVersion) => ({
            put: entries.flatMap(entry => {
              if (records.has(entry.sessionId)) return []
              const record = legacyAttentionRecord(entry, takeVersion())
              return record === null ? [] : [record]
            }),
            remove: [],
          }))
        }),
      })
    }),
  )
}
