import type { StorageTable } from '@dshfiles/dshx/effect/storage-domain'
import { Context, Effect, Layer } from 'effect'
import { BacklogRepo } from './backlog-repo.js'
import type { SyncMapping } from './sync-model.js'

/** One sync mapping per linked item, in the backlog's SQLite file (`sync_mappings`), keyed by the item's numeric id. */
export class BacklogSyncTables extends Context.Service<BacklogSyncTables, { readonly mappings: StorageTable<string, SyncMapping> }>()(
  '@dshfiles/backlog/BacklogSyncTables',
) {
  static readonly layer = Layer.effect(
    BacklogSyncTables,
    BacklogRepo.use(repo => Effect.succeed(BacklogSyncTables.of({ mappings: repo.mappings }))),
  )
}
