import { createHash, randomUUID } from 'node:crypto'
import { StorageDomainReadFailed, StorageDomainWriteFailed, type StorageTable } from '@dshfiles/dshx/effect/storage-domain'
import { Clock, Context, Effect, FileSystem, Layer, Option, Path, Ref, Schema } from 'effect'
import { SqlSchema } from 'effect/sql'
import { BacklogDb, BacklogStorePaths } from './backlog-db.js'
import { BacklogItems, type BacklogAttachment, type BacklogItem } from './item.js'
import type { BacklogLease } from './item-relations.js'
import { LegacyImport, type LegacyImportPlan } from './legacy-import.js'
import { LegacyBacklogTables } from './legacy-tables.js'
import { BacklogOps, type BacklogOp, type BacklogOpRecord, type Hlc } from './op-log.js'
import { ShortAlias } from './short-alias.js'
import { BacklogSyncModel, type SyncMapping } from './sync-model.js'
import { ulid } from './ulid.js'

/** Bumped when the fold changes what an item looks like: the next open rebuilds the `items` cache from `ops`. */
const FOLD_VERSION = '1'
const META_HOST_ID = 'host_id'
const META_NEXT_ID = 'next_id'
const META_FOLD_VERSION = 'fold_version'
const META_LEGACY_IMPORT = 'legacy_import'
const INSERT_CHUNK = 400

const itemJson = Schema.fromJsonString(BacklogItems.itemSchema)
const mappingJson = Schema.fromJsonString(BacklogSyncModel.mappingSchema)
const importMarkerJson = Schema.fromJsonString(
  Schema.Struct({
    at: Schema.Number,
    items: Schema.Number,
    ops: Schema.Number,
    files: Schema.Number,
    blobs: Schema.Number,
    orphanFiles: Schema.Number,
    mappings: Schema.Number,
    nextId: Schema.Number,
  }),
)
export type LegacyImportReport = typeof importMarkerJson.Type

const decodeItem = Schema.decodeUnknownEffect(itemJson)
const encodeItem = Schema.encodeEffect(itemJson)
const decodeOp = Schema.decodeUnknownEffect(BacklogOps.json)
const encodeOp = Schema.encodeEffect(BacklogOps.json)
const decodeMapping = Schema.decodeUnknownEffect(mappingJson)
const encodeMapping = Schema.encodeEffect(mappingJson)

const MetaRow = Schema.Struct({ value: Schema.String })
const ItemRow = Schema.Struct({ item: Schema.String })
const AliasRow = Schema.Struct({ alias: Schema.String, item_id: Schema.String, kind: Schema.String })
const OpRow = Schema.Struct({
  op_id: Schema.String,
  item_id: Schema.String,
  hlc_wall: Schema.Number,
  hlc_counter: Schema.Number,
  hlc_host: Schema.String,
  origin: Schema.String,
  op: Schema.String,
})
const HlcRow = Schema.Struct({ hlc_wall: Schema.Number, hlc_counter: Schema.Number })
const AttachmentRow = Schema.Struct({ sha256: Schema.String, media_type: Schema.String })
const CountRow = Schema.Struct({ count: Schema.Number })
const MappingRow = Schema.Struct({ key: Schema.String, mapping: Schema.String })
const LeaseRow = Schema.Struct({ alias: Schema.String, holder: Schema.String, acquired_at: Schema.Number, expires_at: Schema.Number, heartbeat: Schema.Number })

/** What a write does to the item's claim, in the same transaction as its ops. */
export type LeaseWrite = { readonly kind: 'set'; readonly lease: BacklogLease } | { readonly kind: 'clear' }

const chunks = <A>(values: readonly A[]): A[][] =>
  Array.from({ length: Math.ceil(values.length / INSERT_CHUNK) }, (_unused, index) => values.slice(index * INSERT_CHUNK, (index + 1) * INSERT_CHUNK))

/** A numeric id the store holds in memory has no row in `aliases`: the cache and the log disagree. */
class BacklogAliasMissing extends Schema.TaggedError<BacklogAliasMissing>()('BacklogAliasMissing', { itemId: Schema.Number }) {}

/** The actor who created the item, for the `items.origin` index. */
const originOfItem = (item: BacklogItem): string => BacklogItems.creatorOf(item) ?? 'user'

/**
 * The backlog's SQLite file: the append-only `ops` log, the folded `items` cache, `aliases` from the numeric `b:<n>`
 * ids to the canonical ULID item ids, attachment metadata with content-addressed bytes beside it, sync mappings and
 * `meta`. Opening it imports the legacy JSON domains once, when the log is still empty.
 */
export class BacklogRepo extends Context.Service<
  BacklogRepo,
  {
    readonly hostId: string
    /** Every live item, from the folded cache. */
    readonly loadItems: Effect.Effect<readonly BacklogItem[], unknown>
    /** The next numeric id: never moves backwards, so a deleted item's id is never handed out again. */
    readonly nextId: Effect.Effect<number, unknown>
    /** A new item: mints its ULID, records its numeric alias, writes its ops and advances the id counter, in one transaction. */
    readonly create: (input: {
      readonly item: BacklogItem
      readonly origin: string
      readonly nextId: number
      readonly files: readonly { readonly attachment: BacklogAttachment; readonly data: string }[]
    }) => Effect.Effect<void, unknown>
    /** Appends the ops that turn `prev` into `next` and refreshes the cache row, with its claim change, in one transaction. */
    readonly append: (input: {
      readonly prev: BacklogItem
      readonly next: BacklogItem
      readonly origin: string
      readonly lease?: LeaseWrite | undefined
    }) => Effect.Effect<void, unknown>
    /** Every stored claim by the item's numeric id, live or expired; the sweep removes expired ones. */
    readonly loadLeases: Effect.Effect<ReadonlyMap<number, BacklogLease>, unknown>
    /** A `delete` tombstone, then the item's attachment rows and any bytes no other attachment shares. */
    readonly remove: (input: { readonly item: BacklogItem; readonly origin: string }) => Effect.Effect<void, unknown>
    readonly putFile: (input: { readonly itemId: number; readonly attachment: BacklogAttachment; readonly data: string }) => Effect.Effect<void, unknown>
    readonly readFile: (input: {
      readonly itemId: number
      readonly attachmentId: string
    }) => Effect.Effect<Option.Option<{ readonly mediaType: string; readonly data: string }>, unknown>
    readonly deleteFile: (input: { readonly itemId: number; readonly attachmentId: string }) => Effect.Effect<void, unknown>
    /** Every item folded straight from `ops`, ignoring the cache: what a rebuild or a rehearsal compares against. */
    readonly foldAll: Effect.Effect<readonly BacklogItem[], unknown>
    /** The ops of one item, in log order. */
    readonly opsOf: (itemId: number) => Effect.Effect<readonly BacklogOpRecord[], unknown>
    /** The canonical id of an item's numeric id. */
    readonly canonicalId: (itemId: number) => Effect.Effect<Option.Option<string>>
    /** A short alias no item, live or deleted, has ever held: what a new item shows as `b:<ref>`. */
    readonly mintRef: Effect.Effect<string>
    /** How many rows each table holds, and how many attachment byte files exist. */
    readonly counts: Effect.Effect<{ readonly ops: number; readonly items: number; readonly attachments: number; readonly mappings: number }, unknown>
    /** Every live item with its canonical id, and the whole op log in log order: what a JSONL export writes. */
    readonly exportRows: Effect.Effect<
      { readonly items: readonly { readonly itemId: string; readonly item: BacklogItem }[]; readonly ops: readonly BacklogOpRecord[] },
      unknown
    >
    /** A consistent copy of the whole SQLite file at `path` (`VACUUM INTO`), which must not exist yet. */
    readonly vacuumInto: (path: string) => Effect.Effect<void, unknown>
    /** The receipt the one-time import left, if it ran. */
    readonly importReport: Effect.Effect<Option.Option<LegacyImportReport>, unknown>
    readonly mappings: StorageTable<string, SyncMapping>
  }
>()('@dshfiles/backlog/BacklogRepo') {
  static readonly layer = Layer.effect(
    BacklogRepo,
    Effect.gen(function* () {
      const sql = yield* BacklogDb
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const paths = yield* BacklogStorePaths
      const legacy = yield* LegacyBacklogTables

      const metaGet = SqlSchema.findOneOption({ Request: Schema.String, Result: MetaRow, execute: key => sql`SELECT value FROM meta WHERE key = ${key}` })
      const metaPut = (key: string, value: string) =>
        sql`INSERT INTO meta (key, value) VALUES (${key}, ${value}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`
      const countOf = (table: 'ops' | 'items' | 'attachments' | 'sync_mappings') =>
        Effect.map(
          SqlSchema.findOne({ Request: Schema.Void, Result: CountRow, execute: () => sql`SELECT count(*) AS count FROM ${sql.literal(table)}` })(undefined),
          row => row.count,
        )

      yield* fs.makeDirectory(paths.files, { recursive: true, mode: 0o700 })

      const hostId = yield* Option.match(yield* metaGet(META_HOST_ID), {
        onSome: row => Effect.succeed(row.value),
        onNone: () => {
          const minted = randomUUID()
          return Effect.as(metaPut(META_HOST_ID, minted), minted)
        },
      })

      const blobPath = (sha256: string) => path.join(paths.files, sha256.slice(0, 2), sha256)

      /** Writes the bytes once under their hash; identical bytes from any item or attachment share one file. */
      const putBlob = Effect.fnUntraced(function* (data: string) {
        const bytes = Buffer.from(data, 'base64')
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        const target = blobPath(sha256)
        if (yield* fs.exists(target)) return { sha256, size: bytes.byteLength, written: false }
        yield* fs.makeDirectory(path.dirname(target), { recursive: true, mode: 0o700 })
        const staged = `${target}.${randomUUID()}.tmp`
        yield* fs.writeFile(staged, bytes, { mode: 0o600 })
        yield* fs.rename(staged, target)
        return { sha256, size: bytes.byteLength, written: true }
      })

      const removeUnusedBlob = Effect.fnUntraced(function* (sha256: string) {
        const users = yield* SqlSchema.findOne({
          Request: Schema.String,
          Result: CountRow,
          execute: sha => sql`SELECT count(*) AS count FROM attachments WHERE sha256 = ${sha}`,
        })(sha256)
        if (users.count === 0) yield* fs.remove(blobPath(sha256), { force: true })
      })

      const insertOps = Effect.fnUntraced(function* (records: readonly BacklogOpRecord[]) {
        const rows = yield* Effect.forEach(records, record =>
          Effect.map(encodeOp(record.op), op => ({
            op_id: record.opId,
            item_id: record.itemId,
            hlc_wall: record.hlc.wall,
            hlc_counter: record.hlc.counter,
            hlc_host: record.hlc.host,
            origin: record.origin,
            op,
          })),
        )
        for (const chunk of chunks(rows)) {
          const [first, ...rest] = chunk
          if (first !== undefined) yield* sql`INSERT INTO ops ${sql.insert([first, ...rest])}`
        }
      })

      const writeItemRow = Effect.fnUntraced(function* (input: { readonly itemId: string; readonly item: BacklogItem; readonly deleted: boolean }) {
        const json = yield* encodeItem(input.item)
        yield* sql`INSERT INTO items (item_id, status, project, last_activity_at, origin, deleted, item)
          VALUES (${input.itemId}, ${input.item.status}, ${input.item.project}, ${input.item.lastActivityAt}, ${originOfItem(input.item)}, ${input.deleted ? 1 : 0}, ${json})
          ON CONFLICT (item_id) DO UPDATE SET status = excluded.status, project = excluded.project, last_activity_at = excluded.last_activity_at,
            origin = excluded.origin, deleted = excluded.deleted, item = excluded.item`
      })

      const insertAttachment = (input: { readonly itemId: string; readonly attachment: BacklogAttachment; readonly sha256: string; readonly size: number }) =>
        sql`INSERT OR REPLACE INTO attachments (item_id, attachment_id, sha256, media_type, bytes, created_at)
          VALUES (${input.itemId}, ${input.attachment.id}, ${input.sha256}, ${input.attachment.mediaType}, ${input.size}, ${input.attachment.createdAt})`

      /**
       * `legacy` is the public `b:<n>` of an item created before short aliases, `key` the private numeric id of a newer
       * one (never shown, never resolved as `b:<n>`), and `short` its `b:<ref>`. Both numeric kinds map the store's id.
       */
      const loadAliases = Effect.map(
        SqlSchema.findAll({ Request: Schema.Void, Result: AliasRow, execute: () => sql`SELECT alias, item_id, kind FROM aliases` })(undefined),
        rows => ({
          numeric: new Map(rows.flatMap(row => (row.kind === 'legacy' || row.kind === 'key' ? [[Number(row.alias), row.item_id] as const] : []))),
          short: new Set(rows.flatMap(row => (row.kind === 'short' ? [row.alias] : []))),
        }),
      )

      const readOps = (itemId: string | null) =>
        Effect.flatMap(
          SqlSchema.findAll({
            Request: Schema.NullOr(Schema.String),
            Result: OpRow,
            execute: id =>
              id === null
                ? sql`SELECT * FROM ops ORDER BY item_id, hlc_wall, hlc_counter, hlc_host, op_id`
                : sql`SELECT * FROM ops WHERE item_id = ${id} ORDER BY hlc_wall, hlc_counter, hlc_host, op_id`,
          })(itemId),
          rows =>
            Effect.forEach(rows, row =>
              Effect.map(decodeOp(row.op), (op): BacklogOpRecord => ({
                opId: row.op_id,
                itemId: row.item_id,
                hlc: { wall: row.hlc_wall, counter: row.hlc_counter, host: row.hlc_host },
                origin: row.origin,
                op,
              })),
            ),
        )

      const foldWith = Effect.fnUntraced(function* (aliases: ReadonlyMap<number, string>) {
        const numericOf = new Map([...aliases].map(([alias, itemId]) => [itemId, alias]))
        const byItem = new Map<string, BacklogOpRecord[]>()
        for (const record of yield* readOps(null)) byItem.set(record.itemId, [...(byItem.get(record.itemId) ?? []), record])
        return yield* Effect.forEach([...byItem], ([itemId, records]) => {
          const id = numericOf.get(itemId)
          const item = id === undefined ? null : BacklogOps.fold({ id, records })
          return Effect.map(item === null ? Effect.succeed(null) : Schema.decodeUnknownEffect(BacklogItems.itemSchema)(item), decoded => ({
            itemId,
            item: decoded,
          }))
        })
      })

      /** Writes the imported log, cache, aliases, files and mappings in one transaction; the marker commits with it. */
      const writeImport = Effect.fn('backlog legacy import')(function* (importPlan: LegacyImportPlan) {
        const blobs = yield* Effect.forEach(importPlan.files, file => putBlob(file.data), { concurrency: 4 })
        const at = yield* Clock.currentTimeMillis
        const report: LegacyImportReport = {
          at,
          items: importPlan.items.length,
          ops: importPlan.items.reduce((total, entry) => total + entry.records.length, 0),
          files: importPlan.files.length,
          blobs: new Set(blobs.map(blob => blob.sha256)).size,
          orphanFiles: importPlan.orphanFiles,
          mappings: importPlan.mappings.length,
          nextId: importPlan.nextId,
        }
        yield* Effect.annotateCurrentSpan({
          'dshx.backlog.import.items': report.items,
          'dshx.backlog.import.ops': report.ops,
          'dshx.backlog.import.files': report.files,
          'dshx.backlog.import.blobs': report.blobs,
          'dshx.backlog.import.orphan_files': report.orphanFiles,
          'dshx.backlog.import.mappings': report.mappings,
        })
        yield* sql.withTransaction(
          Effect.gen(function* () {
            for (const entry of importPlan.items) {
              yield* sql`INSERT INTO aliases (alias, item_id, kind, created_at) VALUES (${String(entry.legacyId)}, ${entry.itemId}, 'legacy', ${entry.item.createdAt})`
              yield* insertOps(entry.records)
              yield* writeItemRow({ itemId: entry.itemId, item: entry.item, deleted: false })
            }
            for (const [index, file] of importPlan.files.entries()) {
              const blob = blobs[index]
              if (blob !== undefined) yield* insertAttachment({ itemId: file.itemId, attachment: file.attachment, ...blob })
            }
            for (const [key, mapping] of importPlan.mappings) {
              yield* sql`INSERT OR REPLACE INTO sync_mappings (key, mapping) VALUES (${key}, ${yield* encodeMapping(mapping)})`
            }
            yield* metaPut(META_NEXT_ID, String(importPlan.nextId))
            yield* metaPut(META_FOLD_VERSION, FOLD_VERSION)
            yield* metaPut(META_LEGACY_IMPORT, yield* Schema.encodeEffect(importMarkerJson)(report))
          }),
        )
        return report
      })

      if (Option.isNone(yield* metaGet(META_LEGACY_IMPORT)) && (yield* countOf('ops')) === 0) {
        const snapshot = yield* legacy.snapshot
        yield* writeImport(LegacyImport.plan({ snapshot, host: hostId }))
      }

      const loaded = yield* loadAliases
      const aliases = yield* Ref.make(loaded.numeric)
      const shortAliases = yield* Ref.make(loaded.short)

      if (Option.getOrUndefined(yield* metaGet(META_FOLD_VERSION))?.value !== FOLD_VERSION) {
        const folded = yield* foldWith(yield* Ref.get(aliases))
        yield* sql.withTransaction(
          Effect.gen(function* () {
            for (const entry of folded) {
              if (entry.item === null) yield* sql`UPDATE items SET deleted = 1 WHERE item_id = ${entry.itemId}`
              if (entry.item !== null) yield* writeItemRow({ itemId: entry.itemId, item: entry.item, deleted: false })
            }
            yield* metaPut(META_FOLD_VERSION, FOLD_VERSION)
          }),
        )
      }

      const latest = yield* SqlSchema.findOneOption({
        Request: Schema.Void,
        Result: HlcRow,
        execute: () => sql`SELECT hlc_wall, hlc_counter FROM ops ORDER BY hlc_wall DESC, hlc_counter DESC LIMIT 1`,
      })(undefined)
      const clock = yield* Ref.make<Hlc | null>(
        Option.match(latest, { onNone: () => null, onSome: row => ({ wall: row.hlc_wall, counter: row.hlc_counter, host: hostId }) }),
      )

      const stamp = (input: { readonly itemId: string; readonly origin: string; readonly ops: readonly BacklogOp[] }) =>
        Effect.forEach(input.ops, op =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const hlc = yield* Ref.modify(clock, previous => {
              const next = BacklogOps.nextHlc({ previous, now, host: hostId })
              return [next, next]
            })
            return { opId: ulid(hlc.wall), itemId: input.itemId, hlc, origin: input.origin, op } satisfies BacklogOpRecord
          }),
        )

      const canonicalIdNow = (itemId: number) => Effect.map(Ref.get(aliases), current => Option.fromUndefinedOr(current.get(itemId)))
      const requireCanonical = (itemId: number) =>
        Effect.flatMap(canonicalIdNow(itemId), found =>
          Option.match(found, { onNone: () => Effect.fail(new BacklogAliasMissing({ itemId })), onSome: Effect.succeed }),
        )

      const create = Effect.fnUntraced(function* (input: {
        readonly item: BacklogItem
        readonly origin: string
        readonly nextId: number
        readonly files: readonly { readonly attachment: BacklogAttachment; readonly data: string }[]
      }) {
        const itemId = ulid(input.item.createdAt)
        const records = yield* stamp({ itemId, origin: input.origin, ops: BacklogOps.createOps(input.item) })
        const blobs = yield* Effect.forEach(input.files, file => Effect.map(putBlob(file.data), blob => ({ ...blob, attachment: file.attachment })))
        const ref = input.item.ref
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`INSERT INTO aliases (alias, item_id, kind, created_at) VALUES (${String(input.item.id)}, ${itemId}, ${ref === undefined ? 'legacy' : 'key'}, ${input.item.createdAt})`
            if (ref !== undefined)
              yield* sql`INSERT INTO aliases (alias, item_id, kind, created_at) VALUES (${ref}, ${itemId}, 'short', ${input.item.createdAt})`
            yield* insertOps(records)
            yield* writeItemRow({ itemId, item: input.item, deleted: false })
            yield* Effect.forEach(blobs, blob => insertAttachment({ itemId, ...blob }), { discard: true })
            yield* metaPut(META_NEXT_ID, String(input.nextId))
          }),
        )
        yield* Ref.update(aliases, current => new Map(current).set(input.item.id, itemId))
        if (ref !== undefined) yield* Ref.update(shortAliases, current => new Set(current).add(ref))
      })

      const mintRef = Effect.flatMap(Ref.get(shortAliases), taken => Effect.sync(() => ShortAlias.mint({ taken })))

      const writeLease = (itemId: string, lease: LeaseWrite) =>
        lease.kind === 'clear'
          ? sql`DELETE FROM leases WHERE item_id = ${itemId}`
          : sql`INSERT INTO leases (item_id, holder, acquired_at, expires_at, heartbeat)
              VALUES (${itemId}, ${lease.lease.holder}, ${lease.lease.acquiredAt}, ${lease.lease.expiresAt}, ${lease.lease.heartbeat})
              ON CONFLICT (item_id) DO UPDATE SET holder = excluded.holder, acquired_at = excluded.acquired_at,
                expires_at = excluded.expires_at, heartbeat = excluded.heartbeat`

      const append = Effect.fnUntraced(function* (input: {
        readonly prev: BacklogItem
        readonly next: BacklogItem
        readonly origin: string
        readonly lease?: LeaseWrite | undefined
      }) {
        const ops = BacklogOps.diff(input.prev, input.next)
        if (ops.length === 0 && input.lease === undefined) return
        const itemId = yield* requireCanonical(input.next.id)
        const records = yield* stamp({ itemId, origin: input.origin, ops })
        yield* sql.withTransaction(
          Effect.gen(function* () {
            if (records.length > 0) {
              yield* insertOps(records)
              yield* writeItemRow({ itemId, item: input.next, deleted: false })
            }
            if (input.lease !== undefined) yield* writeLease(itemId, input.lease)
          }),
        )
      })

      const loadLeases = Effect.gen(function* () {
        const rows = yield* SqlSchema.findAll({
          Request: Schema.Void,
          Result: LeaseRow,
          execute: () => sql`SELECT aliases.alias AS alias, leases.holder, leases.acquired_at, leases.expires_at, leases.heartbeat
            FROM leases JOIN aliases ON aliases.item_id = leases.item_id AND aliases.kind IN ('legacy', 'key')`,
        })(undefined)
        return new Map(
          rows.map(
            row => [Number(row.alias), { holder: row.holder, acquiredAt: row.acquired_at, expiresAt: row.expires_at, heartbeat: row.heartbeat }] as const,
          ),
        )
      })

      const remove = Effect.fnUntraced(function* (input: { readonly item: BacklogItem; readonly origin: string }) {
        const itemId = yield* requireCanonical(input.item.id)
        const records = yield* stamp({ itemId, origin: input.origin, ops: [{ kind: 'delete' }] })
        const shared = yield* SqlSchema.findAll({
          Request: Schema.String,
          Result: Schema.Struct({ sha256: Schema.String }),
          execute: id => sql`SELECT DISTINCT sha256 FROM attachments WHERE item_id = ${id}`,
        })(itemId)
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* insertOps(records)
            yield* writeItemRow({ itemId, item: input.item, deleted: true })
            yield* sql`DELETE FROM attachments WHERE item_id = ${itemId}`
            yield* sql`DELETE FROM leases WHERE item_id = ${itemId}`
          }),
        )
        yield* Effect.forEach(shared, row => removeUnusedBlob(row.sha256), { discard: true })
      })

      const putFile = Effect.fnUntraced(function* (input: { readonly itemId: number; readonly attachment: BacklogAttachment; readonly data: string }) {
        const itemId = yield* requireCanonical(input.itemId)
        const blob = yield* putBlob(input.data)
        yield* insertAttachment({ itemId, attachment: input.attachment, ...blob })
      })

      const attachmentRow = (itemId: string, attachmentId: string) =>
        SqlSchema.findOneOption({
          Request: Schema.Struct({ itemId: Schema.String, attachmentId: Schema.String }),
          Result: AttachmentRow,
          execute: key => sql`SELECT sha256, media_type FROM attachments WHERE item_id = ${key.itemId} AND attachment_id = ${key.attachmentId}`,
        })({ itemId, attachmentId })

      const readFile = Effect.fnUntraced(function* (input: { readonly itemId: number; readonly attachmentId: string }) {
        const itemId = yield* canonicalIdNow(input.itemId)
        if (Option.isNone(itemId)) return Option.none()
        const row = yield* attachmentRow(itemId.value, input.attachmentId)
        if (Option.isNone(row)) return Option.none()
        const target = blobPath(row.value.sha256)
        if (!(yield* fs.exists(target))) return Option.none()
        const bytes = yield* fs.readFile(target)
        return Option.some({ mediaType: row.value.media_type, data: Buffer.from(bytes).toString('base64') })
      })

      const deleteFile = Effect.fnUntraced(function* (input: { readonly itemId: number; readonly attachmentId: string }) {
        const itemId = yield* canonicalIdNow(input.itemId)
        if (Option.isNone(itemId)) return
        const row = yield* attachmentRow(itemId.value, input.attachmentId)
        if (Option.isNone(row)) return
        yield* sql`DELETE FROM attachments WHERE item_id = ${itemId.value} AND attachment_id = ${input.attachmentId}`
        yield* removeUnusedBlob(row.value.sha256)
      })

      const loadItems = Effect.flatMap(
        SqlSchema.findAll({ Request: Schema.Void, Result: ItemRow, execute: () => sql`SELECT item FROM items WHERE deleted = 0` })(undefined),
        rows => Effect.forEach(rows, row => decodeItem(row.item)),
      )

      const mappingRow = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: MappingRow,
        execute: key => sql`SELECT key, mapping FROM sync_mappings WHERE key = ${key}`,
      })
      const readFailed = (cause: unknown) => new StorageDomainReadFailed({ domain: 'backlog', table: 'sync_mappings', cause })
      const writeFailed = (operation: StorageDomainWriteFailed['operation']) => (cause: unknown) =>
        new StorageDomainWriteFailed({ domain: 'backlog', table: 'sync_mappings', operation, cause })
      const getMapping = (key: string) =>
        Effect.flatMap(mappingRow(key), row => (Option.isNone(row) ? Effect.succeedNone : Effect.map(decodeMapping(row.value.mapping), Option.some)))
      const putMapping = (key: string, mapping: SyncMapping) =>
        Effect.flatMap(encodeMapping(mapping), json => sql`INSERT OR REPLACE INTO sync_mappings (key, mapping) VALUES (${key}, ${json})`)
      const mappings: StorageTable<string, SyncMapping> = {
        get: key => getMapping(key).pipe(Effect.mapError(readFailed)),
        entries: Effect.flatMap(
          SqlSchema.findAll({ Request: Schema.Void, Result: MappingRow, execute: () => sql`SELECT key, mapping FROM sync_mappings ORDER BY key` })(undefined),
          rows => Effect.forEach(rows, row => Effect.map(decodeMapping(row.mapping), mapping => [row.key, mapping] as const)),
        ).pipe(Effect.mapError(readFailed)),
        size: countOf('sync_mappings').pipe(Effect.mapError(readFailed)),
        put: (key, mapping) => putMapping(key, mapping).pipe(Effect.asVoid, Effect.mapError(writeFailed('put'))),
        delete: key =>
          Effect.map(
            SqlSchema.findAll({
              Request: Schema.String,
              Result: Schema.Struct({ key: Schema.String }),
              execute: id => sql`DELETE FROM sync_mappings WHERE key = ${id} RETURNING key`,
            })(key),
            rows => rows.length > 0,
          ).pipe(Effect.mapError(writeFailed('delete'))),
        update: (key, change) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                const current = yield* getMapping(key)
                if (Option.isNone(current))
                  return yield* new StorageDomainWriteFailed({ domain: 'backlog', table: 'sync_mappings', operation: 'update', code: 'missing-key' })
                const next = change(current.value)
                yield* putMapping(key, next)
                return next
              }),
            )
            .pipe(Effect.catch(cause => Effect.fail(cause instanceof StorageDomainWriteFailed ? cause : writeFailed('update')(cause)))),
      }

      const exportRows = Effect.gen(function* () {
        const canonicalOf = yield* Ref.get(aliases)
        const items = (yield* loadItems).flatMap(item => {
          const itemId = canonicalOf.get(item.id)
          return itemId === undefined ? [] : [{ itemId, item }]
        })
        const ops = [...(yield* readOps(null))].sort((left, right) => BacklogOps.compareHlc(left.hlc, right.hlc) || (left.opId < right.opId ? -1 : 1))
        return { items, ops }
      })

      return BacklogRepo.of({
        hostId,
        loadItems,
        nextId: Effect.map(metaGet(META_NEXT_ID), row => Option.match(row, { onNone: () => 1, onSome: value => Number(value.value) })),
        create,
        append,
        loadLeases,
        remove,
        putFile,
        readFile,
        deleteFile,
        foldAll: Effect.map(Effect.flatMap(Ref.get(aliases), foldWith), entries => entries.flatMap(entry => (entry.item === null ? [] : [entry.item]))),
        opsOf: itemId => Effect.flatMap(requireCanonical(itemId), readOps),
        canonicalId: canonicalIdNow,
        mintRef,
        counts: Effect.all({ ops: countOf('ops'), items: countOf('items'), attachments: countOf('attachments'), mappings: countOf('sync_mappings') }),
        exportRows,
        vacuumInto: path => Effect.asVoid(sql`VACUUM INTO ${path}`),
        importReport: Effect.flatMap(metaGet(META_LEGACY_IMPORT), row =>
          Option.isNone(row) ? Effect.succeedNone : Effect.map(Schema.decodeUnknownEffect(importMarkerJson)(row.value.value), Option.some),
        ),
        mappings,
      })
    }),
  )
}
