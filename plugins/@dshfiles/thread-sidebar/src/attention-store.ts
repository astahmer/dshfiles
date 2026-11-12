import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { Clock, Context, Effect, Layer, Option, PubSub, Schema, Stream, SynchronizedRef } from 'effect'
import {
  compareAttentionViews,
  MAX_ATTENTION_SESSIONS,
  threadAttentionViewSchema,
  type AttentionFinishReason,
  type ThreadAttentionChanges,
  type ThreadAttentionMigrationEntry,
  type ThreadAttentionSnapshot,
  type ThreadAttentionView,
  type ThreadAttentionWriteCommand,
} from './attention-api.js'
import { AttentionStorageFailed } from './sidebar-errors.js'

export const threadAttentionDomain = defineDomain({
  name: 'thread_attention',
  version: 1,
  // One document per unread thread: a write touches its own rows instead of rewriting the whole unit.
  layout: 'per-record',
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
const finishReasonByKind = new Map<string, AttentionFinishReason>([
  ['completed', 'completed'],
  ['aborted', 'aborted'],
  ['blocked', 'blocked'],
  ['error', 'error'],
  ['max-tokens', 'max-tokens'],
])

const finishReasonFromEvent = (event: unknown): AttentionFinishReason | null => {
  const parsed = decodeTurnEnd(event)
  if (Option.isNone(parsed)) return null
  const reason = parsed.value.data.reason
  // The Host shutting down disposes a running Agent: that turn resumes after the restart, it was not stopped by anyone.
  if (reason.kind === 'aborted' && reason.reason?.kind === 'disposed') return null
  return finishReasonByKind.get(reason.kind) ?? null
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

/** The first unseen finish a new finish keeps: the existing record's, else this finish's own sequence. */
const firstUnreadSeq = (existing: ThreadAttentionView | undefined, seq: number | null): number | null => {
  if (existing === undefined || existing.finishedAt === null) return seq
  return existing.firstUnreadSeq ?? existing.finishedSeq ?? seq
}

export class ThreadAttentionStoreModel {
  static readonly boundRemovals = (input: { readonly removedAt: Map<string, number>; readonly floor: number; readonly limit: number }): number =>
    boundRemovals(input.removedAt, input.floor, input.limit)
  static readonly finishReasonFromEvent = finishReasonFromEvent
  static readonly firstUnreadSeq = firstUnreadSeq
  static readonly nextVersion = nextAttentionVersion
  static readonly keysToTrim = attentionKeysToTrim
  static readonly legacyRecord = legacyAttentionRecord
}

interface AttentionState {
  readonly records: ReadonlyMap<string, ThreadAttentionView>
  readonly revision: number
  /** The revision each dropped record was dropped at, since `floor`; a later write of the thread forgets it. */
  readonly removedAt: ReadonlyMap<string, number>
  /** Removals at or before this revision are unknown (before this Host started, or trimmed from `removedAt`). */
  readonly floor: number
}

/** Records written and dropped after `since`, or `complete: false` when a removal since then may be unknown. */
const changesOf = (state: AttentionState, since: number): ThreadAttentionChanges => {
  if (since < state.floor) return { revision: state.revision, complete: false, put: [], removed: [] }
  return {
    revision: state.revision,
    complete: true,
    put: [...state.records.values()].filter(record => record.version > since).sort(compareAttentionViews),
    removed: [...state.removedAt].flatMap(([sessionId, at]) => (at > since ? [sessionId] : [])),
  }
}

/** Keep at most `limit` removals, the newest; the floor rises to the newest one dropped. */
const boundRemovals = (removedAt: Map<string, number>, floor: number, limit = MAX_ATTENTION_SESSIONS): number => {
  if (removedAt.size <= limit) return floor
  const oldest = [...removedAt].sort((left, right) => left[1] - right[1]).slice(0, removedAt.size - limit)
  for (const [sessionId] of oldest) removedAt.delete(sessionId)
  return Math.max(floor, ...oldest.map(([, at]) => at))
}

/** What one change does: rows to put and keys to delete, applied durably before the mirror moves. */
interface AttentionChange {
  readonly put: readonly ThreadAttentionView[]
  readonly remove: readonly string[]
}

type Operation = AttentionStorageFailed['operation']

/** Plans one change against the current records; `takeVersion` reserves the revision a new record version uses. */
type Plan = (records: ReadonlyMap<string, ThreadAttentionView>, takeVersion: () => number) => AttentionChange

const snapshotOf = (state: AttentionState): ThreadAttentionSnapshot => ({
  revision: state.revision,
  sessions: [...state.records.values()].sort(compareAttentionViews),
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
    readonly changesSince: (revision: number) => Effect.Effect<ThreadAttentionChanges>
    /** Every committed change, after the mirror moved; read `snapshot` for the state. */
    readonly changes: Stream.Stream<void>
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
    /** One write, answered with every record changed after `since` instead of the whole snapshot. */
    readonly writeDelta: (input: {
      readonly since: number
      readonly command: ThreadAttentionWriteCommand
    }) => Effect.Effect<ThreadAttentionChanges, AttentionStorageFailed>
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
      const changed = yield* PubSub.sliding<void>(16)
      const initialRevision = Math.max(now, ...stored.map(([, record]) => record.version))
      const state = yield* SynchronizedRef.make<AttentionState>({
        records: new Map(stored),
        revision: initialRevision,
        removedAt: new Map(),
        floor: initialRevision,
      })

      /**
       * Run one change under the mirror's lock: plan it against the current records, write it, then publish it. The
       * answer carries the committed snapshot and a delta reader bound to the same committed state, so a write can
       * report every change since the caller's revision without a second, racy read.
       */
      const commit = (operation: Operation, plan: Plan) =>
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
            // A drop takes a revision too, so a page holding the record before it can learn it from `changesSince`.
            const dropped = [...change.remove, ...trimmed].filter(sessionId => current.records.has(sessionId) && !records.has(sessionId))
            const removedAt = new Map(current.removedAt)
            for (const record of puts) removedAt.delete(record.sessionId)
            if (dropped.length > 0) {
              const droppedAt = takeVersion()
              for (const sessionId of dropped) removedAt.set(sessionId, droppedAt)
            }
            const floor = boundRemovals(removedAt, current.floor)
            const next = { records, revision, removedAt, floor }
            return [{ snapshot: snapshotOf(next), changesFor: (since: number) => changesOf(next, since) }, next] as const
          }).pipe(Effect.mapError(cause => new AttentionStorageFailed({ operation, cause }))),
        ).pipe(Effect.tap(() => PubSub.publish(changed, undefined)))

      const apply = (operation: Operation, plan: Plan) => Effect.map(commit(operation, plan), committed => committed.snapshot)
      const applyDelta = (input: { readonly operation: Operation; readonly plan: Plan; readonly since: number }) =>
        Effect.map(commit(input.operation, input.plan), committed => committed.changesFor(input.since))

      const unchanged: AttentionChange = { put: [], remove: [] }

      const plans = {
        acknowledge:
          (input: { readonly sessionId: string; readonly version: number }): Plan =>
          (records, takeVersion) => {
            const record = records.get(input.sessionId)
            if (record === undefined || record.version > input.version) return unchanged
            if (!record.manuallyUnread) return { put: [], remove: [input.sessionId] }
            return {
              put: [{ sessionId: input.sessionId, version: takeVersion(), finishedAt: null, finishedSeq: null, finishedReason: null, manuallyUnread: true }],
              remove: [],
            }
          },
        clearUnread:
          (input: { readonly sessionId: string; readonly version: number }): Plan =>
          records => {
            const record = records.get(input.sessionId)
            return record === undefined || record.version > input.version ? unchanged : { put: [], remove: [input.sessionId] }
          },
        clearUnreadMany:
          (entries: ReadonlyArray<{ readonly sessionId: string; readonly version: number }>): Plan =>
          records => ({
            put: [],
            remove: entries.flatMap(entry => {
              const record = records.get(entry.sessionId)
              return record === undefined || record.version > entry.version ? [] : [entry.sessionId]
            }),
          }),
        markUnread:
          (input: { readonly sessionId: string }): Plan =>
          (records, takeVersion) => {
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
                  ...(existing?.firstUnreadSeq === undefined ? {} : { firstUnreadSeq: existing.firstUnreadSeq }),
                },
              ],
              remove: [],
            }
          },
        markUnreadMany:
          (sessionIds: ReadonlyArray<string>): Plan =>
          (records, takeVersion) => ({
            put: sessionIds.map(sessionId => {
              const existing = records.get(sessionId)
              return {
                sessionId,
                version: takeVersion(),
                finishedAt: existing?.finishedAt ?? null,
                finishedSeq: existing?.finishedSeq ?? null,
                finishedReason: existing?.finishedReason ?? null,
                manuallyUnread: true,
                ...(existing?.firstUnreadSeq === undefined ? {} : { firstUnreadSeq: existing.firstUnreadSeq }),
              }
            }),
            remove: [],
          }),
        migrate:
          (entries: ReadonlyArray<ThreadAttentionMigrationEntry>): Plan =>
          (records, takeVersion) => ({
            put: entries.flatMap(entry => {
              if (records.has(entry.sessionId)) return []
              const record = legacyAttentionRecord(entry, takeVersion())
              return record === null ? [] : [record]
            }),
            remove: [],
          }),
      }

      const planOf = (command: ThreadAttentionWriteCommand): { plan: Plan; operation: Operation } => {
        if (command.kind === 'acknowledge') return { plan: plans.acknowledge(command), operation: 'acknowledge' }
        if (command.kind === 'clearUnread') return { plan: plans.clearUnread(command), operation: 'clear' }
        if (command.kind === 'clearUnreadMany') return { plan: plans.clearUnreadMany(command.entries), operation: 'clear' }
        if (command.kind === 'markUnread') return { plan: plans.markUnread(command), operation: 'mark' }
        if (command.kind === 'markUnreadMany') return { plan: plans.markUnreadMany(command.sessionIds), operation: 'mark' }
        return { plan: plans.migrate(command.entries), operation: 'migrate' }
      }

      return ThreadAttention.of({
        snapshot: Effect.map(SynchronizedRef.get(state), snapshotOf),
        changesSince: revision => Effect.map(SynchronizedRef.get(state), current => changesOf(current, revision)),
        changes: Stream.fromPubSub(changed),
        recordFinish: Effect.fn('thread attention record')(function* (input) {
          yield* apply('record', (records, takeVersion) => {
            const existing = records.get(input.sessionId)
            return {
              put: [
                {
                  sessionId: input.sessionId,
                  version: takeVersion(),
                  finishedAt: input.time,
                  finishedSeq: input.seq,
                  finishedReason: input.reason,
                  manuallyUnread: existing?.manuallyUnread ?? false,
                  // The first unseen finish stays while more turns finish unseen; reading the thread drops the record.
                  firstUnreadSeq: ThreadAttentionStoreModel.firstUnreadSeq(existing, input.seq),
                },
              ],
              remove: [],
            }
          })
        }),
        acknowledge: Effect.fn('thread attention acknowledge')(function* (input) {
          return yield* apply('acknowledge', plans.acknowledge(input))
        }),
        clearUnread: Effect.fn('thread attention clear')(function* (input) {
          return yield* apply('clear', plans.clearUnread(input))
        }),
        clearUnreadMany: Effect.fn('thread attention clear many')(function* (entries) {
          return yield* apply('clear', plans.clearUnreadMany(entries))
        }),
        markUnread: Effect.fn('thread attention mark')(function* (input) {
          return yield* apply('mark', plans.markUnread(input))
        }),
        markUnreadMany: Effect.fn('thread attention mark many')(function* (sessionIds) {
          return yield* apply('mark', plans.markUnreadMany(sessionIds))
        }),
        migrate: Effect.fn('thread attention migrate')(function* (entries) {
          return yield* apply('migrate', plans.migrate(entries))
        }),
        writeDelta: Effect.fn('thread attention write delta')(function* (input) {
          const { plan, operation } = planOf(input.command)
          return yield* applyDelta({ operation, plan, since: input.since })
        }),
      })
    }),
  )
}
