import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { StorageDomain, type StorageTable } from '@dshfiles/dshx/effect/storage-domain'
import { Context, Effect, Layer } from 'effect'
import { BacklogSyncModel, type SyncMapping } from './sync-model.js'
import { BacklogTables } from './backlog-tables.js'

/**
 * Remote sync state lives in its own versioned domain, one row per linked item, so the `backlog` items domain keeps
 * its v1 rows untouched: turning sync on, off or removing this domain never rewrites or loses an item.
 */
export const backlogSyncDomain = defineDomain({
  name: 'backlog_sync',
  version: 1,
  tables: {
    mappings: { valueSchema: zodSchemaFromEffect(BacklogSyncModel.mappingSchema), __key: 'mappings' },
  },
})

export class BacklogSyncTables extends Context.Service<BacklogSyncTables, { readonly mappings: StorageTable<string, SyncMapping> }>()(
  '@dshfiles/backlog/BacklogSyncTables',
) {
  static readonly layer = Layer.effect(
    BacklogSyncTables,
    Effect.gen(function* () {
      const storage = yield* StorageDomain
      const domain = yield* storage.open(backlogSyncDomain)
      return BacklogSyncTables.of({ mappings: domain.table('mappings') })
    }),
  )

  /** Mappings over a plain map, standing in for the Host storage domain in tests. */
  static readonly layerMemory = (rows: Map<string, SyncMapping>) =>
    Layer.succeed(BacklogSyncTables, BacklogSyncTables.of({ mappings: BacklogTables.memoryTable(rows) }))
}
