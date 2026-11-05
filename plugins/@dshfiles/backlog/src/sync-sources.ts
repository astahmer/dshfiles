import { Context, Effect, Layer, Option, Schema } from 'effect'
import { SqlSchema } from 'effect/sql'
import { BacklogDb } from './backlog-db.js'
import { BacklogRepo } from './backlog-repo.js'
import { BacklogSyncModel, type ExternalRef, type SyncBinding, type SyncConnection } from './sync-model.js'

const connectionJson = Schema.fromJsonString(BacklogSyncModel.connectionSchema)
const bindingJson = Schema.fromJsonString(BacklogSyncModel.bindingSchema)
const refJson = Schema.fromJsonString(BacklogSyncModel.externalRefSchema)

const ConnectionRow = Schema.Struct({ connection: Schema.String })
const BindingRow = Schema.Struct({ binding: Schema.String })
const RefRow = Schema.Struct({ alias: Schema.String, ref: Schema.String })
const StateRow = Schema.Struct({ cursor: Schema.NullOr(Schema.String), last_pass_at: Schema.NullOr(Schema.Number) })
const MetaRow = Schema.Struct({ value: Schema.String })

/** A ref names an item id the alias table does not know: the log and the cache disagree. */
class SyncRefItemMissing extends Schema.TaggedError<SyncRefItemMissing>()('SyncRefItemMissing', { itemId: Schema.Number }) {}

/** One item's tie to one remote item, with the item's numeric store id. */
export interface StoredRef {
  readonly itemId: number
  readonly ref: ExternalRef
}

export interface BindingSyncState {
  readonly cursor: string | null
  readonly lastPassAt: number | null
}

/** The connection set and binding set the panel saves as a whole, and the order it lists them in. */
export interface SyncSourcesSnapshot {
  readonly connections: readonly SyncConnection[]
  readonly bindings: readonly SyncBinding[]
}

/**
 * Where sync configuration and state live: in the backlog's SQLite file, not in settings. Bindings are what external
 * refs and `remote:<bindingId>` origins point at, a binding belongs to one Host (`ownerHostId`), and a save that
 * renames a connection or removes a binding must move or drop its refs in the same transaction; a settings namespace
 * can do none of that. Credentials stay `secret:ALIAS` references resolved on the Host.
 */
export class SyncSources extends Context.Service<
  SyncSources,
  {
    readonly hostId: string
    readonly snapshot: Effect.Effect<SyncSourcesSnapshot, unknown>
    /** Replaces every connection and binding at once; refs and state of bindings that disappear go with them. */
    readonly replace: (input: SyncSourcesSnapshot & { readonly renamedConnections?: ReadonlyMap<string, string> }) => Effect.Effect<void, unknown>
    readonly refs: Effect.Effect<readonly StoredRef[], unknown>
    readonly refsOf: (itemId: number) => Effect.Effect<readonly ExternalRef[], unknown>
    readonly refsOfBinding: (bindingId: string) => Effect.Effect<readonly StoredRef[], unknown>
    readonly refByKey: (input: { readonly bindingId: string; readonly key: string }) => Effect.Effect<Option.Option<StoredRef>, unknown>
    readonly putRef: (input: StoredRef) => Effect.Effect<void, unknown>
    readonly deleteRef: (input: { readonly bindingId: string; readonly key: string }) => Effect.Effect<void, unknown>
    readonly deleteRefsOf: (itemId: number) => Effect.Effect<void, unknown>
    readonly state: (bindingId: string) => Effect.Effect<BindingSyncState, unknown>
    readonly setState: (input: { readonly bindingId: string; readonly cursor: string | null; readonly lastPassAt: number }) => Effect.Effect<void, unknown>
    readonly marker: (key: string) => Effect.Effect<Option.Option<string>, unknown>
    readonly setMarker: (input: { readonly key: string; readonly value: string }) => Effect.Effect<void, unknown>
  }
>()('@dshfiles/backlog/SyncSources') {
  static readonly layer = Layer.effect(
    SyncSources,
    Effect.gen(function* () {
      const sql = yield* BacklogDb
      const repo = yield* BacklogRepo

      const canonical = (itemId: number) =>
        Effect.flatMap(repo.canonicalId(itemId), found =>
          Option.match(found, { onNone: () => Effect.fail(new SyncRefItemMissing({ itemId })), onSome: Effect.succeed }),
        )

      const decodeRefs = (rows: readonly (typeof RefRow.Type)[]) =>
        Effect.forEach(rows, row => Effect.map(Schema.decodeUnknownEffect(refJson)(row.ref), (ref): StoredRef => ({ itemId: Number(row.alias), ref })))

      /** Every ref joined to its item's numeric id, the way leases read theirs. */
      const refRows = (where: { readonly itemId?: string; readonly bindingId?: string; readonly key?: string }) =>
        SqlSchema.findAll({
          Request: Schema.Void,
          Result: RefRow,
          execute: () => sql`SELECT aliases.alias AS alias, external_refs.ref AS ref
            FROM external_refs JOIN aliases ON aliases.item_id = external_refs.item_id AND aliases.kind IN ('legacy', 'key')
            WHERE ${where.itemId === undefined ? sql`1 = 1` : sql`external_refs.item_id = ${where.itemId}`}
              AND ${where.bindingId === undefined ? sql`1 = 1` : sql`external_refs.binding_id = ${where.bindingId}`}
              AND ${where.key === undefined ? sql`1 = 1` : sql`external_refs.key = ${where.key}`}
            ORDER BY external_refs.binding_id, external_refs.key`,
        })(undefined)

      const snapshot = Effect.gen(function* () {
        const connections = yield* Effect.flatMap(
          SqlSchema.findAll({ Request: Schema.Void, Result: ConnectionRow, execute: () => sql`SELECT connection FROM sync_connections ORDER BY position` })(
            undefined,
          ),
          rows => Effect.forEach(rows, row => Schema.decodeUnknownEffect(connectionJson)(row.connection)),
        )
        const bindings = yield* Effect.flatMap(
          SqlSchema.findAll({ Request: Schema.Void, Result: BindingRow, execute: () => sql`SELECT binding FROM sync_bindings ORDER BY position` })(undefined),
          rows => Effect.forEach(rows, row => Schema.decodeUnknownEffect(bindingJson)(row.binding)),
        )
        return { connections, bindings }
      })

      const replace = Effect.fnUntraced(function* (input: SyncSourcesSnapshot & { readonly renamedConnections?: ReadonlyMap<string, string> }) {
        const connections = yield* Effect.forEach(input.connections, connection => Schema.encodeEffect(connectionJson)(connection))
        const bindings = yield* Effect.forEach(input.bindings, binding => Schema.encodeEffect(bindingJson)(binding))
        const keptBindings = input.bindings.map(binding => binding.id)
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`DELETE FROM sync_connections`
            yield* sql`DELETE FROM sync_bindings`
            for (const [index, json] of connections.entries()) {
              const connection = input.connections[index]
              if (connection !== undefined)
                yield* sql`INSERT INTO sync_connections (instance_id, position, connection) VALUES (${connection.instanceId}, ${index}, ${json})`
            }
            for (const [index, json] of bindings.entries()) {
              const binding = input.bindings[index]
              if (binding !== undefined)
                yield* sql`INSERT INTO sync_bindings (binding_id, connection_id, position, binding) VALUES (${binding.id}, ${binding.connectionId}, ${index}, ${json})`
            }
            if (keptBindings.length === 0) {
              yield* sql`DELETE FROM external_refs`
              yield* sql`DELETE FROM sync_state`
            } else {
              yield* sql`DELETE FROM external_refs WHERE binding_id NOT IN ${sql.in(keptBindings)}`
              yield* sql`DELETE FROM sync_state WHERE binding_id NOT IN ${sql.in(keptBindings)}`
            }
          }),
        )
      })

      const putRef = Effect.fnUntraced(function* (input: StoredRef) {
        const itemId = yield* canonical(input.itemId)
        const json = yield* Schema.encodeEffect(refJson)(input.ref)
        yield* sql`INSERT INTO external_refs (item_id, binding_id, key, ref) VALUES (${itemId}, ${input.ref.bindingId}, ${input.ref.key}, ${json})
          ON CONFLICT (binding_id, key) DO UPDATE SET item_id = excluded.item_id, ref = excluded.ref`
      })

      const marker = (key: string) =>
        Effect.map(
          SqlSchema.findOneOption({ Request: Schema.String, Result: MetaRow, execute: name => sql`SELECT value FROM meta WHERE key = ${name}` })(key),
          Option.map(row => row.value),
        )

      return SyncSources.of({
        hostId: repo.hostId,
        snapshot,
        replace,
        refs: Effect.flatMap(refRows({}), decodeRefs),
        refsOf: itemId =>
          Effect.flatMap(repo.canonicalId(itemId), found =>
            Option.isNone(found)
              ? Effect.succeed([])
              : Effect.map(Effect.flatMap(refRows({ itemId: found.value }), decodeRefs), rows => rows.map(row => row.ref)),
          ),
        refsOfBinding: bindingId => Effect.flatMap(refRows({ bindingId }), decodeRefs),
        refByKey: input => Effect.map(Effect.flatMap(refRows(input), decodeRefs), rows => Option.fromUndefinedOr(rows[0])),
        putRef,
        deleteRef: input => Effect.asVoid(sql`DELETE FROM external_refs WHERE binding_id = ${input.bindingId} AND key = ${input.key}`),
        deleteRefsOf: itemId =>
          Effect.flatMap(repo.canonicalId(itemId), found =>
            Option.isNone(found) ? Effect.void : Effect.asVoid(sql`DELETE FROM external_refs WHERE item_id = ${found.value}`),
          ),
        state: bindingId =>
          Effect.map(
            SqlSchema.findOneOption({
              Request: Schema.String,
              Result: StateRow,
              execute: id => sql`SELECT cursor, last_pass_at FROM sync_state WHERE binding_id = ${id}`,
            })(bindingId),
            row =>
              Option.match(row, {
                onNone: () => ({ cursor: null, lastPassAt: null }),
                onSome: value => ({ cursor: value.cursor, lastPassAt: value.last_pass_at }),
              }),
          ),
        setState: input =>
          Effect.asVoid(sql`INSERT INTO sync_state (binding_id, cursor, last_pass_at) VALUES (${input.bindingId}, ${input.cursor}, ${input.lastPassAt})
            ON CONFLICT (binding_id) DO UPDATE SET cursor = excluded.cursor, last_pass_at = excluded.last_pass_at`),
        marker,
        setMarker: input =>
          Effect.asVoid(sql`INSERT INTO meta (key, value) VALUES (${input.key}, ${input.value}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`),
      })
    }),
  )
}
