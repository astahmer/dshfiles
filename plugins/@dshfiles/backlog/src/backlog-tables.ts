import { StorageDomain, StorageDomainWriteFailed, type StorageTable } from '@dshfiles/dshx/effect/storage-domain'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { BacklogItems, type BacklogItem } from './item.js'

/**
 * `defineDomain` still types its record validator as a zod schema; `zodSchemaFromEffect` publishes each Effect record
 * schema in that shape, so a stored row is decoded by the same schema that writes it and keeps the defaults older rows
 * omit.
 */
export const backlogDomain = defineDomain({
  name: 'backlog',
  version: 1,
  tables: {
    items: { valueSchema: zodSchemaFromEffect(BacklogItems.itemSchema), __key: 'items' },
  },
})

/** File bytes live beside the items instead of inside them: a list never decodes a megabyte it does not show. */
const storedFileSchema = Schema.Struct({
  itemId: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  attachment: BacklogItems.attachmentSchema,
  data: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(12_000_000)),
})

export const backlogFileDomain = defineDomain({
  name: 'backlog_files',
  version: 1,
  tables: {
    files: { valueSchema: zodSchemaFromEffect(storedFileSchema), __key: 'files' },
  },
})

export type BacklogFileRecord = typeof storedFileSchema.Type

/**
 * The next item id, kept apart from the items so it never moves backwards: deriving it from the largest stored id
 * would hand a deleted item's id to the next capture after a restart. A new domain, so the item rows keep their v1.
 */
const idCounterSchema = Schema.Struct({ nextId: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)) })

export const backlogMetaDomain = defineDomain({
  name: 'backlog_meta',
  version: 1,
  tables: {
    counters: { valueSchema: zodSchemaFromEffect(idCounterSchema), __key: 'counters' },
  },
})

export type BacklogIdCounter = typeof idCounterSchema.Type

/** The durable tables the backlog keeps: one row per item, one per attachment, and the id counter. */
export class BacklogTables extends Context.Service<
  BacklogTables,
  {
    readonly items: StorageTable<string, BacklogItem>
    readonly files: StorageTable<string, BacklogFileRecord>
    readonly counters: StorageTable<string, BacklogIdCounter>
  }
>()('@dshfiles/backlog/BacklogTables') {
  static readonly layer = Layer.effect(
    BacklogTables,
    Effect.gen(function* () {
      const storage = yield* StorageDomain
      const items = yield* storage.open(backlogDomain)
      const files = yield* storage.open(backlogFileDomain)
      const meta = yield* storage.open(backlogMetaDomain)
      return BacklogTables.of({ items: items.table('items'), files: files.table('files'), counters: meta.table('counters') })
    }),
  )

  /** Tables over plain maps, standing in for the Host storage domain; pass the same maps again to model a restart. */
  static readonly layerMemory = (rows: {
    readonly items: Map<string, BacklogItem>
    readonly files: Map<string, BacklogFileRecord>
    readonly counters: Map<string, BacklogIdCounter>
  }) => Layer.succeed(BacklogTables, BacklogTables.of({ items: memoryTable(rows.items), files: memoryTable(rows.files), counters: memoryTable(rows.counters) }))

  /** One table over a plain map, for any backlog domain a test stands in for. */
  static readonly memoryTable = <Value>(rows: Map<string, Value>): StorageTable<string, Value> => memoryTable(rows)
}

const memoryTable = <Value>(rows: Map<string, Value>): StorageTable<string, Value> => ({
  get: key => Effect.sync(() => Option.fromUndefinedOr(rows.get(key))),
  entries: Effect.sync(() => [...rows.entries()]),
  size: Effect.sync(() => rows.size),
  put: (key, value) => Effect.sync(() => void rows.set(key, value)),
  delete: key => Effect.sync(() => rows.delete(key)),
  update: (key, change) =>
    Effect.suspend(() => {
      const current = rows.get(key)
      if (current === undefined) return Effect.fail(new StorageDomainWriteFailed({ domain: 'memory', table: key, operation: 'update', code: 'missing-key' }))
      const next = change(current)
      rows.set(key, next)
      return Effect.succeed(next)
    }),
})
