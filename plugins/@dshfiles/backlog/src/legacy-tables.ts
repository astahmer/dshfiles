import { StorageDomain, type StorageDomainOpenFailed, type StorageDomainReadFailed } from '@dshfiles/dshx/effect/storage-domain'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { BacklogItems, type BacklogItem } from './item.js'
import { BacklogSyncModel, type SyncMapping } from './sync-model.js'

/**
 * The storage-domain JSON tables the backlog kept before its SQLite op log. They are read once, by the importer, and
 * never written or deleted: they stay on disk as the rollback until the user confirms the new store.
 */
const backlogDomain = defineDomain({
  name: 'backlog',
  version: 1,
  tables: {
    items: { valueSchema: zodSchemaFromEffect(BacklogItems.itemSchema), __key: 'items' },
  },
})

const storedFileSchema = Schema.Struct({
  itemId: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  attachment: BacklogItems.attachmentSchema,
  data: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(12_000_000)),
})

const backlogFileDomain = defineDomain({
  name: 'backlog_files',
  version: 1,
  tables: {
    files: { valueSchema: zodSchemaFromEffect(storedFileSchema), __key: 'files' },
  },
})

export type LegacyFileRecord = typeof storedFileSchema.Type

const idCounterSchema = Schema.Struct({ nextId: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)) })

const backlogMetaDomain = defineDomain({
  name: 'backlog_meta',
  version: 1,
  tables: {
    counters: { valueSchema: zodSchemaFromEffect(idCounterSchema), __key: 'counters' },
  },
})

const backlogSyncDomain = defineDomain({
  name: 'backlog_sync',
  version: 1,
  tables: {
    mappings: { valueSchema: zodSchemaFromEffect(BacklogSyncModel.mappingSchema), __key: 'mappings' },
  },
})

/** Everything the JSON domains hold, read in one pass. */
export interface LegacySnapshot {
  readonly items: readonly BacklogItem[]
  readonly files: readonly LegacyFileRecord[]
  readonly mappings: readonly (readonly [string, SyncMapping])[]
  readonly nextId: number | null
}

const emptySnapshot: LegacySnapshot = { items: [], files: [], mappings: [], nextId: null }

export class LegacyBacklogTables extends Context.Service<
  LegacyBacklogTables,
  { readonly snapshot: Effect.Effect<LegacySnapshot, StorageDomainOpenFailed | StorageDomainReadFailed> }
>()('@dshfiles/backlog/LegacyBacklogTables') {
  /** Opens the four domains only when the importer asks, and closes them right after reading. */
  static readonly layer = Layer.effect(
    LegacyBacklogTables,
    Effect.gen(function* () {
      const storage = yield* StorageDomain
      const snapshot = Effect.scoped(
        Effect.gen(function* () {
          const items = yield* (yield* storage.open(backlogDomain)).table('items').entries
          const files = yield* (yield* storage.open(backlogFileDomain)).table('files').entries
          const counter = yield* (yield* storage.open(backlogMetaDomain)).table('counters').get('items')
          const mappings = yield* (yield* storage.open(backlogSyncDomain)).table('mappings').entries
          return {
            items: items.map(([, item]) => item),
            files: files.map(([, file]) => file),
            mappings,
            nextId: Option.match(counter, { onNone: () => null, onSome: value => value.nextId }),
          } satisfies LegacySnapshot
        }),
      )
      return LegacyBacklogTables.of({ snapshot })
    }),
  )

  /** A fixed snapshot standing in for the JSON domains: empty by default, or the rows a test or rehearsal supplies. */
  static readonly layerMemory = (snapshot: Partial<LegacySnapshot> = {}) =>
    Layer.succeed(LegacyBacklogTables, LegacyBacklogTables.of({ snapshot: Effect.succeed({ ...emptySnapshot, ...snapshot }) }))
}
