/**
 * The settled status (which threads are done, and since when) in the sidebar's own storage domain. It used to be two
 * fields of the `thread-sidebar` settings namespace, and core's `settings/describe` sends a namespace's stored values
 * twice (the effective value and the user layer) on every read: 1,192 settled ids made ~520 KB of the 786 KB the live
 * page loaded twice per boot, and every other settings write re-sent them. The store keeps one record, the whole
 * ordered status, in a `single`-layout domain: a scan that settles a thousand threads is one write, as the settings
 * field was, instead of a thousand files.
 *
 * The migration moves those fields here without losing a choice: merge them into the store, read the record back, then
 * clear the fields. It is idempotent: an interrupted run repeats on the next start, a later write of the fields (an
 * older page still open) moves them again, and a Host without them does nothing.
 */
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { Api, DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import type { SettingsValue } from '@dshfiles/dshx/settings'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { Clock, Context, Effect, Layer, Option, PubSub, Schedule, Schema, Semaphore, Stream, SubscriptionRef } from 'effect'
import { threadSidebarSettledApi } from './settled-api.js'
import { threadSidebarSettings } from './settings.js'
import { SidebarSettingsWriteFailed } from './sidebar-errors.js'
import type { SettledStatus } from './settled-threads.js'

const settledStatusSchema = Schema.Struct({
  /** Settled threads in the order they were settled. */
  settledSessionIds: Schema.Array(Schema.String),
  /** When each was settled; an id settled before the instant was recorded has none. */
  settledAt: Schema.Record(Schema.String, Schema.Number),
})

/** The one record's key. */
const STATUS_KEY = 'status'

export const settledThreadsDomain = defineDomain({
  name: 'thread_settled',
  version: 1,
  layout: 'single',
  tables: {
    status: { valueSchema: zodSchemaFromEffect(settledStatusSchema), __key: 'status' },
  },
})

/** The settled status with the store's revision, which moves on every committed change. */
export interface SettledSnapshot extends SettledStatus {
  readonly revision: number
}

type SidebarSettingsValueShape = SettingsValue<typeof threadSidebarSettings.schema>

const LegacySettings = Settings.Tag<SidebarSettingsValueShape>(threadSidebarSettings.namespace)

const CONFLICT_RETRY = { schedule: Schedule.spaced('50 millis'), times: 20 } as const

const EMPTY: SettledStatus = { settledSessionIds: [], settledAt: {} }

const copyOf = (status: { readonly settledSessionIds: readonly string[]; readonly settledAt: Readonly<Record<string, number>> }): SettledStatus => ({
  settledSessionIds: [...status.settledSessionIds],
  settledAt: { ...status.settledAt },
})

const sameStatus = (left: SettledStatus, right: SettledStatus): boolean => JSON.stringify(left) === JSON.stringify(right)

/** The legacy fields merged into the store's status: every id of either, the stored instant first. */
const mergeLegacy = (stored: SettledStatus, legacy: SettledStatus): SettledStatus => ({
  settledSessionIds: [...new Set([...stored.settledSessionIds, ...legacy.settledSessionIds])],
  settledAt: { ...legacy.settledAt, ...stored.settledAt },
})

interface SettledTable {
  readonly read: Effect.Effect<SettledStatus, unknown>
  readonly write: (status: SettledStatus) => Effect.Effect<void, unknown>
}

/** A unit test without a Host keeps the record in memory; the plugin always runs with its storage domain. */
const memoryTable = (): SettledTable => {
  let stored = EMPTY
  return {
    read: Effect.sync(() => copyOf(stored)),
    write: status =>
      Effect.sync(() => {
        stored = copyOf(status)
      }),
  }
}

const openTable = Effect.gen(function* () {
  const host = yield* Effect.serviceOption(HostContext)
  if (Option.isNone(host)) return memoryTable()
  const domains = yield* StorageDomain.pipe(Effect.provide(StorageDomain.layer), Effect.provideService(HostContext, host.value))
  const table = (yield* domains.open(settledThreadsDomain)).table('status')
  const stored: SettledTable = {
    read: Effect.map(table.get(STATUS_KEY), found => (Option.isSome(found) ? copyOf(found.value) : EMPTY)),
    write: status => table.put(STATUS_KEY, status),
  }
  return stored
})

const hasLegacy = (value: { readonly settledSessionIds: readonly string[]; readonly settledAt: Readonly<Record<string, number>> }): boolean =>
  value.settledSessionIds.length > 0 || Object.keys(value.settledAt).length > 0

export class SettledStore extends Context.Service<
  SettledStore,
  {
    /** The status as of the last commit, read without running an effect for the prompt-admission hot path. */
    readonly current: () => SettledSnapshot
    readonly snapshot: Effect.Effect<SettledSnapshot>
    /** Every committed change after the current one. */
    readonly changes: Stream.Stream<SettledSnapshot>
    /** Apply one change under the store's lock and persist it in one write. */
    readonly update: <A>(
      change: (status: SettledStatus, now: number) => { readonly status: SettledStatus; readonly result: A },
    ) => Effect.Effect<A, SidebarSettingsWriteFailed>
    /** Move any settled ids still held by the settings namespace into the store; a no-op when it holds none. */
    readonly migrate: Effect.Effect<void, SidebarSettingsWriteFailed>
  }
>()('@dshfiles/thread-sidebar/SettledStore') {
  static readonly layer = Layer.effect(
    SettledStore,
    Effect.gen(function* () {
      const settings = yield* LegacySettings
      const table = yield* openTable.pipe(Effect.mapError(cause => new SidebarSettingsWriteFailed({ cause })))
      /** What storage holds; a change is written only when the status differs from it. */
      let persisted = yield* table.read.pipe(Effect.mapError(cause => new SidebarSettingsWriteFailed({ cause })))
      const startedAt = yield* Clock.currentTimeMillis
      const exclusive = (yield* Semaphore.make(1)).withPermits(1)
      /** Ids unsettled since this start: a legacy copy of them, still in Settings, must not settle them again. */
      const dropped = new Set<string>()
      const legacyOf = (value: SidebarSettingsValueShape): SettledStatus => ({
        settledSessionIds: value.settledSessionIds.filter(sessionId => !dropped.has(sessionId)),
        settledAt: { ...value.settledAt },
      })
      // The gate, the scans and the first page read see the legacy ids at once; the background move persists them.
      const startup = legacyOf(yield* settings.get)
      let current = hasLegacy(startup) ? mergeLegacy(persisted, startup) : persisted
      const state = yield* SubscriptionRef.make<SettledSnapshot>({ ...copyOf(current), revision: startedAt })
      const committed = yield* PubSub.sliding<SettledSnapshot>(16)

      const update = <A>(change: (status: SettledStatus, now: number) => { readonly status: SettledStatus; readonly result: A }) =>
        exclusive(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const planned = change(copyOf(current), now)
            const ids = [...new Set(planned.status.settledSessionIds)]
            // Keep only the instants still backed by a settled id, so the record cannot grow.
            const settledAt = Object.fromEntries(ids.flatMap(sessionId => {
              const at = planned.status.settledAt[sessionId]
              return at === undefined ? [] : [[sessionId, at] as const]
            }))
            const next: SettledStatus = { settledSessionIds: ids, settledAt }
            for (const sessionId of current.settledSessionIds) if (!next.settledSessionIds.includes(sessionId)) dropped.add(sessionId)
            for (const sessionId of next.settledSessionIds) dropped.delete(sessionId)
            if (!sameStatus(next, persisted)) {
              yield* table.write(next)
              persisted = next
            }
            if (sameStatus(next, current)) return planned.result
            current = next
            const latest = yield* SubscriptionRef.get(state)
            const snapshot: SettledSnapshot = { ...copyOf(next), revision: Math.max(latest.revision + 1, now) }
            yield* SubscriptionRef.set(state, snapshot)
            yield* PubSub.publish(committed, snapshot)
            return planned.result
          }).pipe(Effect.mapError(cause => (cause instanceof SidebarSettingsWriteFailed ? cause : new SidebarSettingsWriteFailed({ cause })))),
        )

      const migrateOnce = Effect.gen(function* () {
        const snapshot = yield* settings.snapshot
        if (!hasLegacy(snapshot.value)) return
        const legacy = legacyOf(snapshot.value)
        yield* update(status => ({ status: mergeLegacy(status, legacy), result: undefined }))
        // Clear the fields only once every id reads back from storage, so a failed write leaves them in Settings.
        const readBack = new Set((yield* table.read.pipe(Effect.mapError(cause => new SidebarSettingsWriteFailed({ cause })))).settledSessionIds)
        const missing = legacy.settledSessionIds.filter(sessionId => !readBack.has(sessionId) && !dropped.has(sessionId))
        if (missing.length > 0) return yield* new SidebarSettingsWriteFailed({ cause: `${String(missing.length)} settled ids did not read back` })
        yield* settings.update({ settledSessionIds: [], settledAt: {} }, snapshot.revision)
      })
      const migrate = migrateOnce.pipe(
        // Another write moved the namespace past this snapshot: read it again and merge what it holds now.
        Effect.retry({ ...CONFLICT_RETRY, while: error => typeof error === 'object' && error !== null && '_tag' in error && error._tag === 'SettingsConflict' }),
        Effect.mapError(cause => (cause instanceof SidebarSettingsWriteFailed ? cause : new SidebarSettingsWriteFailed({ cause }))),
        Effect.withSpan('settled threads migrate'),
      )

      // Pages re-read the settled threads when they change, whoever changed them (a scan, the Agent, another page).
      const host = yield* Effect.serviceOption(HostContext)
      if (Option.isSome(host)) {
        yield* Stream.fromPubSub(committed).pipe(
          Stream.runForEach(snapshot =>
            Api.publish({ contract: threadSidebarSettledApi, event: 'changed', payload: { revision: snapshot.revision } }).pipe(
              Effect.provideService(HostContext, host.value),
              Effect.catchTag('PublishEventError', error => Effect.logWarning('thread-sidebar: settled change event refused', error.message)),
            ),
          ),
          DshxPlugin.detached,
          Effect.forkScoped,
        )
      }
      yield* DshxPlugin.worker(
        migrate.pipe(Effect.catch(error => Effect.logWarning('thread-sidebar: settled ids stay in Settings until the next start', error.message))),
      )
      // An older page still writes the fields: move what it writes.
      yield* DshxPlugin.worker(
        settings.changes.pipe(
          Stream.filter(hasLegacy),
          Stream.runForEach(() => migrate.pipe(Effect.catch(error => Effect.logWarning('thread-sidebar: settled ids not moved yet', error.message)))),
        ),
      )

      return SettledStore.of({
        current: () => SubscriptionRef.getUnsafe(state),
        snapshot: SubscriptionRef.get(state),
        changes: Stream.fromPubSub(committed),
        update,
        migrate,
      })
    }),
  )
}
