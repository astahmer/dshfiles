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
import { LegacySyncMappings, type SyncMapping } from './sync-legacy-mapping.js'
import { derivedUlid, ulid } from './ulid.js'

/** Bumped when the fold changes what an item looks like: the next open rebuilds the `items` cache from `ops`. */
const FOLD_VERSION = '1'
const META_HOST_ID = 'host_id'
const META_NEXT_ID = 'next_id'
const META_FOLD_VERSION = 'fold_version'
const META_LEGACY_IMPORT = 'legacy_import'
const INSERT_CHUNK = 400

const itemJson = Schema.fromJsonString(BacklogItems.itemSchema)
const mappingJson = Schema.fromJsonString(LegacySyncMappings.schema)
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
const SeqRow = Schema.Struct({ seq: Schema.NullOr(Schema.Number) })
const PeerOpRow = Schema.Struct({ ...OpRow.fields, seq: Schema.Number })
const ExistingOpRow = Schema.Struct({ op_id: Schema.String, hlc_wall: Schema.Number, hlc_counter: Schema.Number, hlc_host: Schema.String })
const AttachmentKeyRow = Schema.Struct({ item_id: Schema.String, attachment_id: Schema.String, sha256: Schema.String })
const PeerStateRow = Schema.Struct({
  runtime_id: Schema.String,
  remote_host_id: Schema.NullOr(Schema.String),
  cursor: Schema.Number,
  head: Schema.Number,
  pulled: Schema.Number,
  last_pull_at: Schema.NullOr(Schema.Number),
  last_success_at: Schema.NullOr(Schema.Number),
  last_error_code: Schema.NullOr(Schema.String),
  last_error: Schema.NullOr(Schema.String),
})

/** One op as a peer serves it: its place in that Host's log, and the op as the stored JSON the receiver decodes itself. */
export interface PeerOpWire {
  readonly seq: number
  readonly opId: string
  readonly itemId: string
  readonly hlc: Hlc
  readonly origin: string
  readonly op: string
}

/** How far this Host pulled one multi-host runtime's backlog, and how the last pull went. Never replicated. */
export interface PeerState {
  readonly runtimeId: string
  /** The backlog Host id behind the runtime; a different one means a new log, so the cursor starts over. */
  readonly remoteHostId: string | null
  readonly cursor: number
  /** The peer's newest sequence number when last asked: `head - cursor` is how many ops are still to pull. */
  readonly head: number
  /** Ops this Host took from that peer, all time. */
  readonly pulled: number
  readonly lastPullAt: number | null
  readonly lastSuccessAt: number | null
  readonly lastErrorCode: string | null
  readonly lastError: string | null
}

/** What one ingest changed: the items as this Host now folds them (null once deleted), and merged refs it now redirects. */
export interface IngestResult {
  readonly inserted: number
  readonly items: readonly { readonly id: number; readonly item: BacklogItem | null }[]
  readonly redirects: readonly (readonly [alias: string, target: string])[]
  readonly nextId: number
}

const attachmentIdsOf = (item: BacklogItem): ReadonlySet<string> =>
  new Set([...item.attachments.map(attachment => attachment.id), ...item.events.flatMap(event => (event.attachments ?? []).map(attachment => attachment.id))])

const laterHlc = (left: Hlc | null, right: Hlc): Hlc => (left === null || BacklogOps.compareHlc(right, left) > 0 ? right : left)
const AttachmentRow = Schema.Struct({ sha256: Schema.String, media_type: Schema.String })
const CountRow = Schema.Struct({ count: Schema.Number })
const MappingRow = Schema.Struct({ key: Schema.String, mapping: Schema.String })
const RedirectRow = Schema.Struct({ alias: Schema.String, target: Schema.String })
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
    /**
     * A new item: mints its ULID, records its numeric alias, writes its ops and advances the id counter, in one
     * transaction. `identity` fixes the item id and its `create` op id, for an item every Host derives the same way.
     */
    readonly create: (input: {
      readonly item: BacklogItem
      readonly origin: string
      readonly nextId: number
      readonly files: readonly { readonly attachment: BacklogAttachment; readonly data: string }[]
      readonly identity?: { readonly itemId: string; readonly createOpId: string } | undefined
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
    /** Every merged duplicate's ref and the ref of the item it was merged into. */
    readonly loadRedirects: Effect.Effect<ReadonlyMap<string, string>, unknown>
    /**
     * Records that `alias` (merged duplicate `itemId`'s ref) now names `target` (survivor `targetId`'s ref): a `redirect`
     * op on the duplicate, so every peer learns it too, and the row this Host resolves refs with.
     */
    readonly addRedirect: (input: {
      readonly itemId: number
      readonly targetId: number
      readonly alias: string
      readonly target: string
      readonly origin: string
    }) => Effect.Effect<void, unknown>
    /** Ops this Host stored after `cursor` in its own storing order, at most `limit` and about `maxBytes`, and its newest sequence. */
    readonly opsSince: (input: {
      readonly cursor: number
      readonly limit: number
      readonly maxBytes: number
    }) => Effect.Effect<{ readonly ops: readonly PeerOpWire[]; readonly head: number }, unknown>
    /**
     * Adds a peer's ops: an op already stored is skipped (a same-id op with an earlier stamp replaces it, so Hosts that
     * derived one op agree), the clock moves past the newest stamp, and only the items those ops touch are folded again.
     * Items new to this Host get a private numeric id; ref collisions and merged refs are settled the same way on every Host.
     */
    readonly ingest: (input: { readonly records: readonly BacklogOpRecord[]; readonly nextId: number }) => Effect.Effect<IngestResult, unknown>
    /** The numeric id of a canonical item id, when this Host has the item. */
    readonly numericId: (itemId: string) => Effect.Effect<Option.Option<number>>
    /** The short alias each legacy item answers to on other Hosts (they cannot use its `b:<n>`), by the item's numeric id. */
    readonly derivedAliases: Effect.Effect<ReadonlyMap<string, number>>
    /** One attachment's stored bytes, by canonical item id, for a peer that lacks them. */
    readonly blobOf: (input: {
      readonly itemId: string
      readonly attachmentId: string
    }) => Effect.Effect<Option.Option<{ readonly sha256: string; readonly mediaType: string; readonly data: string }>, unknown>
    /** Stores bytes a peer sent for an attachment this Host's item already names; false when they do not hash to `sha256`. */
    readonly storeFetchedFile: (input: {
      readonly itemId: number
      readonly attachment: BacklogAttachment
      readonly sha256: string
      readonly data: string
    }) => Effect.Effect<boolean, unknown>
    /** Every attachment this Host has bytes for, as `<numeric id>:<attachment id>`. */
    readonly attachmentKeys: Effect.Effect<ReadonlySet<string>, unknown>
    readonly peerStates: Effect.Effect<readonly PeerState[], unknown>
    readonly putPeerState: (state: PeerState) => Effect.Effect<void, unknown>
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
    /**
     * A short alias no item, live or deleted, has ever held: what a new item shows as `b:<ref>`. With a `seed` the draw
     * repeats on every Host, for an item several Hosts may create from the same facts.
     */
    readonly mintRef: (seed?: string) => Effect.Effect<string>
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

      /**
       * Appends ops with the next sequence numbers. Callers run it inside a transaction (`BEGIN IMMEDIATE`), so sequence
       * numbers commit in order and a peer reading after its cursor never misses a lower one. `ignoreExisting` skips an op
       * id already stored, for ops a peer or a deterministic rule may deliver twice.
       */
      const insertOps = Effect.fnUntraced(function* (records: readonly BacklogOpRecord[], options: { readonly ignoreExisting?: boolean } = {}) {
        if (records.length === 0) return
        const top = yield* SqlSchema.findOne({ Request: Schema.Void, Result: SeqRow, execute: () => sql`SELECT max(seq) AS seq FROM ops` })(undefined)
        const base = (top.seq ?? 0) + 1
        const rows = yield* Effect.forEach(records, (record, index) =>
          Effect.map(encodeOp(record.op), op => ({
            op_id: record.opId,
            item_id: record.itemId,
            hlc_wall: record.hlc.wall,
            hlc_counter: record.hlc.counter,
            hlc_host: record.hlc.host,
            origin: record.origin,
            op,
            seq: base + index,
          })),
        )
        for (const chunk of chunks(rows)) {
          const [first, ...rest] = chunk
          if (first === undefined) continue
          yield* options.ignoreExisting === true
            ? sql`INSERT INTO ops ${sql.insert([first, ...rest])} ON CONFLICT (op_id) DO NOTHING`
            : sql`INSERT INTO ops ${sql.insert([first, ...rest])}`
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
          short: new Map(rows.flatMap(row => (row.kind === 'short' ? [[row.alias, row.item_id] as const] : []))),
          legacy: new Set(rows.flatMap(row => (row.kind === 'legacy' ? [row.item_id] : []))),
        }),
      )

      /** The ref another Host's legacy item shows here, where its `b:<n>` would name one of this Host's own items. */
      const derivedRefOf = (itemId: string): string => ShortAlias.derived({ seed: itemId, taken: new Set() })

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
        const legacy = yield* Ref.get(legacyItems)
        return yield* Effect.forEach([...byItem], ([itemId, records]) => {
          const id = numericOf.get(itemId)
          const folded = id === undefined ? null : BacklogOps.fold({ id, records })
          const item = folded === null ? null : localView({ itemId, item: folded, legacy })
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
      const aliases = yield* Ref.make<ReadonlyMap<number, string>>(loaded.numeric)
      const shortAliases = yield* Ref.make<ReadonlyMap<string, string>>(loaded.short)
      const legacyItems = yield* Ref.make<ReadonlySet<string>>(loaded.legacy)

      /** An item as this Host shows it: another Host's legacy item takes its derived ref, since its `b:<n>` means another item here. */
      const localView = (input: { readonly itemId: string; readonly item: BacklogItem; readonly legacy: ReadonlySet<string> }): BacklogItem =>
        input.item.ref === undefined && !input.legacy.has(input.itemId) ? { ...input.item, ref: derivedRefOf(input.itemId) } : input.item

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
        readonly identity?: { readonly itemId: string; readonly createOpId: string } | undefined
      }) {
        const identity = input.identity
        const itemId = identity?.itemId ?? ulid(input.item.createdAt)
        const stamped = yield* stamp({ itemId, origin: input.origin, ops: BacklogOps.createOps(input.item) })
        const records = identity === undefined ? stamped : stamped.map((record, index) => (index === 0 ? { ...record, opId: identity.createOpId } : record))
        const blobs = yield* Effect.forEach(input.files, file => Effect.map(putBlob(file.data), blob => ({ ...blob, attachment: file.attachment })))
        const ref = input.item.ref
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`INSERT INTO aliases (alias, item_id, kind, created_at) VALUES (${String(input.item.id)}, ${itemId}, ${ref === undefined ? 'legacy' : 'key'}, ${input.item.createdAt})`
            if (ref !== undefined)
              yield* sql`INSERT INTO aliases (alias, item_id, kind, created_at) VALUES (${ref}, ${itemId}, 'short', ${input.item.createdAt})`
            yield* insertOps(records, { ignoreExisting: identity !== undefined })
            yield* writeItemRow({ itemId, item: input.item, deleted: false })
            yield* Effect.forEach(blobs, blob => insertAttachment({ itemId, ...blob }), { discard: true })
            yield* metaPut(META_NEXT_ID, String(input.nextId))
          }),
        )
        yield* Ref.update(aliases, current => new Map(current).set(input.item.id, itemId))
        if (ref !== undefined) yield* Ref.update(shortAliases, current => new Map(current).set(ref, itemId))
        if (ref === undefined) yield* Ref.update(legacyItems, current => new Set(current).add(itemId))
      })

      const mintRef = (seed?: string) =>
        Effect.flatMap(Ref.get(shortAliases), taken =>
          Effect.sync(() => ShortAlias.mint(seed === undefined ? { taken } : { taken, pick: ShortAlias.seededPick(seed) })),
        )

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
        putMany: entries =>
          entries.length === 0
            ? Effect.void
            : sql
                .withTransaction(Effect.forEach(entries, ([key, mapping]) => putMapping(key, mapping), { discard: true }))
                .pipe(Effect.mapError(writeFailed('put-many'))),
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
        const ops = [...(yield* readOps(null))].sort(BacklogOps.compareRecords)
        return { items, ops }
      })

      const loadRedirects = Effect.map(
        SqlSchema.findAll({ Request: Schema.Void, Result: RedirectRow, execute: () => sql`SELECT alias, target FROM alias_redirects` })(undefined),
        rows => new Map(rows.map(row => [row.alias, row.target] as const)),
      )
      const putRedirect = (input: { readonly alias: string; readonly target: string; readonly at: number }) =>
        sql`INSERT INTO alias_redirects (alias, target, created_at) VALUES (${input.alias}, ${input.target}, ${input.at})
          ON CONFLICT (alias) DO UPDATE SET target = excluded.target, created_at = excluded.created_at`

      const addRedirect = Effect.fnUntraced(function* (input: {
        readonly itemId: number
        readonly targetId: number
        readonly alias: string
        readonly target: string
        readonly origin: string
      }) {
        const itemId = yield* requireCanonical(input.itemId)
        const targetId = yield* requireCanonical(input.targetId)
        const records = yield* stamp({ itemId, origin: input.origin, ops: [{ kind: 'redirect', target: targetId }] })
        const at = records[0]?.hlc.wall ?? (yield* Clock.currentTimeMillis)
        yield* sql.withTransaction(Effect.andThen(insertOps(records), putRedirect({ alias: input.alias, target: input.target, at })))
      })

      const opsSince = Effect.fn('backlog peer ops since')(function* (input: { readonly cursor: number; readonly limit: number; readonly maxBytes: number }) {
        const rows = yield* SqlSchema.findAll({
          Request: Schema.Struct({ cursor: Schema.Number, limit: Schema.Number }),
          Result: PeerOpRow,
          execute: request => sql`SELECT * FROM ops WHERE seq > ${request.cursor} ORDER BY seq LIMIT ${request.limit}`,
        })({ cursor: input.cursor, limit: input.limit })
        const top = yield* SqlSchema.findOne({ Request: Schema.Void, Result: SeqRow, execute: () => sql`SELECT max(seq) AS seq FROM ops` })(undefined)
        const ops: PeerOpWire[] = []
        const budget = { bytes: 0 }
        for (const row of rows) {
          budget.bytes += row.op.length + row.origin.length + 160
          if (ops.length > 0 && budget.bytes > input.maxBytes) break
          ops.push({
            seq: row.seq,
            opId: row.op_id,
            itemId: row.item_id,
            hlc: { wall: row.hlc_wall, counter: row.hlc_counter, host: row.hlc_host },
            origin: row.origin,
            op: row.op,
          })
        }
        yield* Effect.annotateCurrentSpan({ 'dshx.backlog.peer.ops': ops.length, 'dshx.backlog.peer.cursor': input.cursor })
        return { ops, head: top.seq ?? 0 }
      })

      const existingOps = (opIds: readonly string[]) =>
        Effect.map(
          Effect.forEach(chunks(opIds), chunk =>
            SqlSchema.findAll({
              Request: Schema.Array(Schema.String),
              Result: ExistingOpRow,
              execute: ids => sql`SELECT op_id, hlc_wall, hlc_counter, hlc_host FROM ops WHERE ${sql.in('op_id', ids)}`,
            })(chunk),
          ),
          rows => new Map(rows.flat().map(row => [row.op_id, { wall: row.hlc_wall, counter: row.hlc_counter, host: row.hlc_host }] as const)),
        )

      /** When the item was created, for which of two items holding one ref keeps it: the older, then the smaller id. */
      const birthOf = (itemId: string, records: readonly BacklogOpRecord[]) => {
        const create = records.find(record => record.op.kind === 'create')
        return create === undefined || create.op.kind !== 'create' ? null : { itemId, createdAt: create.op.item.createdAt, record: create }
      }

      /**
       * The op every Host writes for the newer of two items that hold one ref: a new derived ref and a note, stamped right
       * after the item's own `create` with an id derived from the facts, so each Host that sees the clash stores one copy.
       */
      const renameOp = (input: { readonly record: BacklogOpRecord; readonly from: string }): BacklogOpRecord => {
        const ref = ShortAlias.derived({ seed: `${input.record.itemId}:${input.from}`, taken: new Set() })
        const at = input.record.hlc.wall
        return {
          opId: derivedUlid({ time: at, seed: `rename-ref:${input.record.itemId}:${input.from}` }),
          itemId: input.record.itemId,
          hlc: { wall: at, counter: input.record.hlc.counter + 1, host: input.record.hlc.host },
          origin: 'system',
          op: {
            kind: 'rename-ref',
            ref,
            event: {
              at,
              actor: 'system',
              origin: 'system',
              kind: 'edited',
              detail: `b:${input.from} was also given to an older item on another Host, so this item is now b:${ref}.`,
            },
          },
        }
      }

      /** Folds the touched items again, gives new ones a numeric id, settles ref clashes and drops bytes no item names now. */
      const reconcile = Effect.fnUntraced(function* (input: { readonly itemIds: readonly string[]; readonly nextId: number }) {
        const legacy = yield* Ref.get(legacyItems)
        const numeric = new Map(yield* Ref.get(aliases))
        const numericOf = new Map([...numeric].map(([id, itemId]) => [itemId, id] as const))
        const shortOwners = new Map(yield* Ref.get(shortAliases))
        const counter = { next: Math.max(input.nextId, Option.match(yield* metaGet(META_NEXT_ID), { onNone: () => 1, onSome: row => Number(row.value) })) }
        const folded = new Map<string, BacklogItem | null>()
        const orphans = new Set<string>()
        const pending = [...input.itemIds]
        const passes = { left: input.itemIds.length * 4 + 16 }
        while (pending.length > 0 && passes.left > 0) {
          passes.left -= 1
          const itemId = pending.shift()
          if (itemId === undefined) break
          const records = yield* readOps(itemId)
          const item = BacklogOps.fold({ id: 0, records })
          const known = numericOf.get(itemId)
          if (item === null) {
            if (known === undefined) continue
            const stored = yield* SqlSchema.findAll({
              Request: Schema.String,
              Result: Schema.Struct({ sha256: Schema.String }),
              execute: id => sql`SELECT DISTINCT sha256 FROM attachments WHERE item_id = ${id}`,
            })(itemId)
            for (const row of stored) orphans.add(row.sha256)
            yield* sql`UPDATE items SET deleted = 1 WHERE item_id = ${itemId}`
            yield* sql`DELETE FROM attachments WHERE item_id = ${itemId}`
            yield* sql`DELETE FROM leases WHERE item_id = ${itemId}`
            folded.set(itemId, null)
            continue
          }
          const ref = item.ref
          const owner = ref === undefined ? undefined : shortOwners.get(ref)
          if (ref !== undefined && owner !== undefined && owner !== itemId) {
            const mine = birthOf(itemId, records)
            const theirs = birthOf(owner, yield* readOps(owner))
            const loser =
              mine === null || theirs === null
                ? null
                : theirs.createdAt < mine.createdAt || (theirs.createdAt === mine.createdAt && theirs.itemId < mine.itemId)
                  ? mine
                  : theirs
            if (loser !== null) {
              yield* insertOps([renameOp({ record: loser.record, from: ref })], { ignoreExisting: true })
              const winner = loser.itemId === itemId ? owner : itemId
              yield* sql`INSERT INTO aliases (alias, item_id, kind, created_at) VALUES (${ref}, ${winner}, 'short', ${loser.createdAt})
                ON CONFLICT (alias) DO UPDATE SET item_id = excluded.item_id`
              shortOwners.set(ref, winner)
              pending.push(loser.itemId)
              if (loser.itemId === itemId) continue
            }
          }
          if (ref !== undefined && !shortOwners.has(ref)) {
            yield* sql`INSERT INTO aliases (alias, item_id, kind, created_at) VALUES (${ref}, ${itemId}, 'short', ${item.createdAt}) ON CONFLICT (alias) DO NOTHING`
            shortOwners.set(ref, itemId)
          }
          const id = known ?? counter.next
          if (known === undefined) {
            counter.next += 1
            yield* sql`INSERT INTO aliases (alias, item_id, kind, created_at) VALUES (${String(id)}, ${itemId}, 'key', ${item.createdAt})`
            numeric.set(id, itemId)
            numericOf.set(itemId, id)
          }
          const shown = localView({ itemId, item: { ...item, id }, legacy })
          yield* writeItemRow({ itemId, item: shown, deleted: false })
          const kept = attachmentIdsOf(shown)
          const stored = yield* SqlSchema.findAll({
            Request: Schema.String,
            Result: AttachmentKeyRow,
            execute: id => sql`SELECT item_id, attachment_id, sha256 FROM attachments WHERE item_id = ${id}`,
          })(itemId)
          const dropped = stored.filter(candidate => !kept.has(candidate.attachment_id))
          if (dropped.length > 0)
            yield* sql`DELETE FROM attachments WHERE item_id = ${itemId} AND ${sql.in(
              'attachment_id',
              dropped.map(row => row.attachment_id),
            )}`
          for (const row of dropped) orphans.add(row.sha256)
          folded.set(itemId, shown)
        }
        yield* metaPut(META_NEXT_ID, String(counter.next))
        return {
          items: [...folded].flatMap(([itemId, item]) => {
            const id = numericOf.get(itemId)
            return id === undefined ? [] : [{ id, item }]
          }),
          numeric,
          shortOwners,
          orphans,
          nextId: counter.next,
        }
      })

      /** A merged duplicate's ref and its survivor's, as this Host shows the two items, once both are here. */
      const redirectOf = (input: { readonly record: BacklogOpRecord; readonly numericOf: ReadonlyMap<string, number> }) =>
        Effect.gen(function* () {
          const op = input.record.op
          if (op.kind !== 'redirect') return null
          const duplicate = input.numericOf.get(input.record.itemId)
          const survivor = input.numericOf.get(op.target)
          if (duplicate === undefined || survivor === undefined) return null
          const refs = yield* SqlSchema.findAll({
            Request: Schema.Array(Schema.String),
            Result: Schema.Struct({ item_id: Schema.String, item: Schema.String }),
            execute: ids => sql`SELECT item_id, item FROM items WHERE ${sql.in('item_id', ids)}`,
          })([input.record.itemId, op.target])
          const refOfItem = (itemId: string, id: number) =>
            Effect.map(Effect.option(decodeItem(refs.find(row => row.item_id === itemId)?.item ?? '')), item =>
              Option.match(item, { onNone: () => String(id), onSome: value => value.ref ?? String(id) }),
            )
          return [yield* refOfItem(input.record.itemId, duplicate), yield* refOfItem(op.target, survivor), input.record.hlc.wall] as const
        })

      const ingest = Effect.fn('backlog peer ingest')(function* (input: { readonly records: readonly BacklogOpRecord[]; readonly nextId: number }) {
        const empty: IngestResult = { inserted: 0, items: [], redirects: [], nextId: input.nextId }
        if (input.records.length === 0) return empty
        const applied = yield* sql.withTransaction(
          Effect.gen(function* () {
            const known = yield* existingOps(input.records.map(record => record.opId))
            const accepted = input.records.filter(record => {
              const stored = known.get(record.opId)
              return stored === undefined || BacklogOps.compareHlc(record.hlc, stored) < 0
            })
            if (accepted.length === 0) return null
            const replaced = accepted.filter(record => known.has(record.opId)).map(record => record.opId)
            for (const chunk of chunks(replaced)) yield* sql`DELETE FROM ops WHERE ${sql.in('op_id', chunk)}`
            yield* insertOps(accepted, { ignoreExisting: true })
            const reconciled = yield* reconcile({ itemIds: [...new Set(accepted.map(record => record.itemId))], nextId: input.nextId })
            const numericOf = new Map([...reconciled.numeric].map(([id, itemId]) => [itemId, id] as const))
            const redirects = (yield* Effect.forEach(accepted, record => redirectOf({ record, numericOf }))).flatMap(entry => (entry === null ? [] : [entry]))
            yield* Effect.forEach(redirects, ([alias, target, at]) => putRedirect({ alias, target, at }), { discard: true })
            return { accepted: accepted.length, reconciled, redirects: redirects.map(([alias, target]) => [alias, target] as const) }
          }),
        )
        if (applied === null) return empty
        yield* Ref.set(aliases, applied.reconciled.numeric)
        yield* Ref.set(shortAliases, applied.reconciled.shortOwners)
        const newest = input.records.reduce<Hlc | null>((latest, record) => laterHlc(latest, record.hlc), null)
        if (newest !== null)
          yield* Ref.update(clock, current => (current === null || BacklogOps.compareHlc(newest, current) > 0 ? { ...newest, host: hostId } : current))
        yield* Effect.forEach(applied.reconciled.orphans, removeUnusedBlob, { discard: true })
        yield* Effect.annotateCurrentSpan({ 'dshx.backlog.peer.ops': applied.accepted, 'dshx.backlog.peer.items': applied.reconciled.items.length })
        return {
          inserted: applied.accepted,
          items: applied.reconciled.items,
          redirects: applied.redirects,
          nextId: applied.reconciled.nextId,
        } satisfies IngestResult
      })

      const numericId = (itemId: string) =>
        Effect.map(Ref.get(aliases), current => Option.fromUndefinedOr([...current].find(([, candidate]) => candidate === itemId)?.[0]))

      const derivedAliases = Effect.gen(function* () {
        const legacy = yield* Ref.get(legacyItems)
        return new Map([...(yield* Ref.get(aliases))].flatMap(([id, itemId]) => (legacy.has(itemId) ? [[derivedRefOf(itemId), id] as const] : [])))
      })

      const blobOf = Effect.fnUntraced(function* (input: { readonly itemId: string; readonly attachmentId: string }) {
        const row = yield* attachmentRow(input.itemId, input.attachmentId)
        if (Option.isNone(row)) return Option.none()
        const target = blobPath(row.value.sha256)
        if (!(yield* fs.exists(target))) return Option.none()
        const bytes = yield* fs.readFile(target)
        return Option.some({ sha256: row.value.sha256, mediaType: row.value.media_type, data: Buffer.from(bytes).toString('base64') })
      })

      const storeFetchedFile = Effect.fnUntraced(function* (input: {
        readonly itemId: number
        readonly attachment: BacklogAttachment
        readonly sha256: string
        readonly data: string
      }) {
        const itemId = yield* requireCanonical(input.itemId)
        if (createHash('sha256').update(Buffer.from(input.data, 'base64')).digest('hex') !== input.sha256) return false
        const blob = yield* putBlob(input.data)
        yield* insertAttachment({ itemId, attachment: input.attachment, ...blob })
        return true
      })

      const attachmentKeys = Effect.gen(function* () {
        const rows = yield* SqlSchema.findAll({
          Request: Schema.Void,
          Result: AttachmentKeyRow,
          execute: () => sql`SELECT item_id, attachment_id, sha256 FROM attachments`,
        })(undefined)
        const numericOf = new Map([...(yield* Ref.get(aliases))].map(([id, itemId]) => [itemId, id] as const))
        return new Set(
          rows.flatMap(row => {
            const id = numericOf.get(row.item_id)
            return id === undefined ? [] : [`${String(id)}:${row.attachment_id}`]
          }),
        )
      })

      const peerStates = Effect.map(
        SqlSchema.findAll({ Request: Schema.Void, Result: PeerStateRow, execute: () => sql`SELECT * FROM peer_state ORDER BY runtime_id` })(undefined),
        rows =>
          rows.map((row): PeerState => ({
            runtimeId: row.runtime_id,
            remoteHostId: row.remote_host_id,
            cursor: row.cursor,
            head: row.head,
            pulled: row.pulled,
            lastPullAt: row.last_pull_at,
            lastSuccessAt: row.last_success_at,
            lastErrorCode: row.last_error_code,
            lastError: row.last_error,
          })),
      )
      const putPeerState = (state: PeerState) =>
        Effect.asVoid(sql`INSERT INTO peer_state (runtime_id, remote_host_id, cursor, head, pulled, last_pull_at, last_success_at, last_error_code, last_error)
          VALUES (${state.runtimeId}, ${state.remoteHostId}, ${state.cursor}, ${state.head}, ${state.pulled}, ${state.lastPullAt}, ${state.lastSuccessAt}, ${state.lastErrorCode}, ${state.lastError})
          ON CONFLICT (runtime_id) DO UPDATE SET remote_host_id = excluded.remote_host_id, cursor = excluded.cursor, head = excluded.head, pulled = excluded.pulled,
            last_pull_at = excluded.last_pull_at, last_success_at = excluded.last_success_at, last_error_code = excluded.last_error_code, last_error = excluded.last_error`)

      return BacklogRepo.of({
        hostId,
        loadRedirects,
        addRedirect,
        opsSince,
        ingest,
        numericId,
        derivedAliases,
        blobOf,
        storeFetchedFile,
        attachmentKeys,
        peerStates,
        putPeerState,
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
