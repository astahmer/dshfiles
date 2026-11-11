import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { StorageDomain, StorageDomainReadFailed, StorageDomainWriteFailed } from '@dshfiles/dshx/effect/storage-domain'
import { Context, Effect, Layer, Option } from 'effect'
import { ownedWatchRecordSchema, pullRequestRecordSchema, type OwnedWatchRecord, type PullRequestRecord } from './pull-request-model.js'

export const pullRequestDomain = defineDomain({
  name: 'pull_requests',
  version: 1,
  tables: {
    links: { valueSchema: zodSchemaFromEffect(pullRequestRecordSchema), __key: 'id' },
    // Added after version 1 shipped: a stored domain without it opens with the table empty.
    owned: { valueSchema: zodSchemaFromEffect(ownedWatchRecordSchema), __key: 'id' },
  },
})

const compareRecords = (left: PullRequestRecord, right: PullRequestRecord): number =>
  left.sessionId.localeCompare(right.sessionId) || left.repo.localeCompare(right.repo) || left.number - right.number

export class PullRequestStore extends Context.Service<
  PullRequestStore,
  {
    readonly get: (id: string) => Effect.Effect<PullRequestRecord | undefined, StorageDomainReadFailed>
    readonly list: (sessionId?: string) => Effect.Effect<readonly PullRequestRecord[], StorageDomainReadFailed>
    readonly watched: Effect.Effect<readonly PullRequestRecord[], StorageDomainReadFailed>
    readonly upsert: (record: PullRequestRecord) => Effect.Effect<PullRequestRecord, StorageDomainReadFailed | StorageDomainWriteFailed>
    readonly updateIfWatching: (
      id: string,
      update: (record: PullRequestRecord) => PullRequestRecord,
    ) => Effect.Effect<PullRequestRecord | undefined, StorageDomainReadFailed | StorageDomainWriteFailed>
    readonly setWatching: (id: string, watching: boolean) => Effect.Effect<PullRequestRecord | undefined, StorageDomainReadFailed | StorageDomainWriteFailed>
    readonly remove: (id: string) => Effect.Effect<boolean, StorageDomainWriteFailed>
    /** Watches owned by something other than a thread (a backlog item). */
    readonly owned: Effect.Effect<readonly OwnedWatchRecord[], StorageDomainReadFailed>
    /** Adds an owned watch, or turns an existing one back on while keeping its last known state. */
    readonly upsertOwned: (record: OwnedWatchRecord) => Effect.Effect<OwnedWatchRecord, StorageDomainReadFailed | StorageDomainWriteFailed>
    readonly updateOwnedIfWatching: (
      id: string,
      update: (record: OwnedWatchRecord) => OwnedWatchRecord,
    ) => Effect.Effect<OwnedWatchRecord | undefined, StorageDomainReadFailed | StorageDomainWriteFailed>
    readonly removeOwned: (ids: readonly string[]) => Effect.Effect<number, StorageDomainWriteFailed>
  }
>()('@dshfiles/pull-requests/PullRequestStore') {
  static readonly layer = Layer.effect(
    PullRequestStore,
    Effect.gen(function* () {
      const storage = yield* StorageDomain
      const domain = yield* storage.open(pullRequestDomain)
      const links = domain.table('links')

      const get = Effect.fn('pull-requests store get')(function* (id: string) {
        const found = yield* links.get(id)
        return Option.getOrUndefined(found)
      })

      const list = Effect.fn('pull-requests store list')(function* (sessionId?: string) {
        const records = (yield* links.entries).map(([, record]) => record)
        return records.filter(record => sessionId === undefined || record.sessionId === sessionId).sort(compareRecords)
      })

      const upsert = Effect.fn('pull-requests store link')(function* (record: PullRequestRecord) {
        return yield* domain.withWriteLock(
          Effect.gen(function* () {
            const existing = yield* links.get(record.id)
            if (Option.isNone(existing)) {
              yield* links.put(record.id, record)
              return record
            }
            const previous = existing.value
            const next: PullRequestRecord = {
              ...record,
              watching: previous.watching || record.watching,
              lastKnownState: previous.lastKnownState,
              lastCheckedAt: previous.lastCheckedAt,
              retryAfterAt: previous.retryAfterAt,
              consecutiveRateLimits: previous.consecutiveRateLimits,
              lastError: previous.lastError,
            }
            yield* links.put(record.id, next)
            return next
          }),
        )
      })

      const updateIfWatching = Effect.fn('pull-requests store update')(function* (id: string, update: (record: PullRequestRecord) => PullRequestRecord) {
        return yield* domain.withWriteLock(
          Effect.gen(function* () {
            const existing = yield* links.get(id)
            if (Option.isNone(existing) || !existing.value.watching) return undefined
            const next = update(existing.value)
            yield* links.put(id, next)
            return next
          }),
        )
      })

      const setWatching = Effect.fn('pull-requests store watch')(function* (id: string, watching: boolean) {
        return yield* domain.withWriteLock(
          Effect.gen(function* () {
            const existing = yield* links.get(id)
            if (Option.isNone(existing)) return undefined
            const next = { ...existing.value, watching }
            yield* links.put(id, next)
            return next
          }),
        )
      })

      const remove = Effect.fn('pull-requests store unlink')(function* (id: string) {
        return yield* domain.withWriteLock(links.delete(id))
      })

      const ownedTable = domain.table('owned')

      const owned = Effect.map(ownedTable.entries, entries => entries.map(([, record]) => record)).pipe(Effect.withSpan('pull-requests store owned'))

      const upsertOwned = Effect.fn('pull-requests store own')(function* (record: OwnedWatchRecord) {
        return yield* domain.withWriteLock(
          Effect.gen(function* () {
            const existing = yield* ownedTable.get(record.id)
            const next: OwnedWatchRecord = Option.isNone(existing)
              ? record
              : {
                  ...existing.value,
                  cwd: record.cwd.length > 0 ? record.cwd : existing.value.cwd,
                  // A terminal pull request is not polled again: its state no longer changes.
                  watching: existing.value.watching || existing.value.lastKnownState === null || existing.value.lastKnownState.state === 'OPEN',
                }
            yield* ownedTable.put(record.id, next)
            return next
          }),
        )
      })

      const updateOwnedIfWatching = Effect.fn('pull-requests store update owned')(function* (
        id: string,
        update: (record: OwnedWatchRecord) => OwnedWatchRecord,
      ) {
        return yield* domain.withWriteLock(
          Effect.gen(function* () {
            const existing = yield* ownedTable.get(id)
            if (Option.isNone(existing) || !existing.value.watching) return undefined
            const next = update(existing.value)
            yield* ownedTable.put(id, next)
            return next
          }),
        )
      })

      const removeOwned = Effect.fn('pull-requests store release owned')(function* (ids: readonly string[]) {
        return yield* domain.withWriteLock(
          Effect.map(
            Effect.forEach(ids, id => ownedTable.delete(id)),
            removed => removed.filter(Boolean).length,
          ),
        )
      })

      return PullRequestStore.of({
        get,
        list,
        watched: Effect.map(list(), records => records.filter(record => record.watching)),
        upsert,
        updateIfWatching,
        setWatching,
        remove,
        owned,
        upsertOwned,
        updateOwnedIfWatching,
        removeOwned,
      })
    }),
  )
}
