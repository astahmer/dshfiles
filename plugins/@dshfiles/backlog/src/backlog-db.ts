import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { SqliteStore } from '@dshfiles/sqlite-store'
import { Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

/** Where the backlog keeps its data: one SQLite file and a folder of content-addressed attachment bytes. */
export class BacklogStorePaths extends Context.Service<BacklogStorePaths, { readonly database: string; readonly files: string }>()(
  '@dshfiles/backlog/BacklogStorePaths',
) {
  static readonly layer = (paths: { readonly database: string; readonly files: string }) => Layer.succeed(BacklogStorePaths, BacklogStorePaths.of(paths))
  /** `$DSH_HOME/plugins/backlog/`, resolved when the plugin activates, like every other plugin-owned store. */
  static readonly fromDshHome = Layer.effect(
    BacklogStorePaths,
    Effect.sync(() => BacklogStorePaths.of({ database: dshHomePath('plugins', 'backlog', 'backlog.db'), files: dshHomePath('plugins', 'backlog', 'files') })),
  )
}

const opLogSchema = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE ops (
    op_id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    hlc_wall INTEGER NOT NULL,
    hlc_counter INTEGER NOT NULL,
    hlc_host TEXT NOT NULL,
    origin TEXT NOT NULL,
    op TEXT NOT NULL
  )`,
  `CREATE INDEX ops_item_order ON ops (item_id, hlc_wall, hlc_counter, hlc_host, op_id)`,
  `CREATE INDEX ops_order ON ops (hlc_wall, hlc_counter, hlc_host, op_id)`,
  `CREATE TABLE items (
    item_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    project TEXT,
    last_activity_at INTEGER NOT NULL,
    origin TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    item TEXT NOT NULL
  )`,
  `CREATE INDEX items_status ON items (status) WHERE deleted = 0`,
  `CREATE INDEX items_project ON items (project) WHERE deleted = 0`,
  `CREATE INDEX items_last_activity ON items (last_activity_at) WHERE deleted = 0`,
  `CREATE INDEX items_origin ON items (origin) WHERE deleted = 0`,
  `CREATE TABLE aliases (alias TEXT PRIMARY KEY, item_id TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX aliases_item ON aliases (item_id)`,
  `CREATE TABLE attachments (
    item_id TEXT NOT NULL,
    attachment_id TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    media_type TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (item_id, attachment_id)
  )`,
  `CREATE INDEX attachments_sha ON attachments (sha256)`,
  `CREATE TABLE sync_mappings (key TEXT PRIMARY KEY, mapping TEXT NOT NULL)`,
]

export const backlogMigrations = {
  '1_op_log': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* Effect.forEach(opLogSchema, statement => sql.unsafe(statement), { discard: true })
  }),
  '2_shipped_summaries': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE shipped_summaries (
      cache_key TEXT PRIMARY KEY,
      items_hash TEXT NOT NULL,
      summary TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      generated_at INTEGER NOT NULL
    )`
  }),
  '3_leases': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE leases (
      item_id TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      heartbeat INTEGER NOT NULL
    )`
  }),
  '4_sync_sources': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE sync_connections (instance_id TEXT PRIMARY KEY, position INTEGER NOT NULL, connection TEXT NOT NULL)`
    yield* sql`CREATE TABLE sync_bindings (binding_id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, position INTEGER NOT NULL, binding TEXT NOT NULL)`
    yield* sql`CREATE INDEX sync_bindings_connection ON sync_bindings (connection_id)`
    yield* sql`CREATE TABLE external_refs (item_id TEXT NOT NULL, binding_id TEXT NOT NULL, key TEXT NOT NULL, ref TEXT NOT NULL, PRIMARY KEY (binding_id, key))`
    yield* sql`CREATE UNIQUE INDEX external_refs_item_binding ON external_refs (item_id, binding_id)`
    yield* sql`CREATE TABLE sync_state (binding_id TEXT PRIMARY KEY, cursor TEXT, last_pass_at INTEGER, last_error TEXT)`
  }),
  /** A merged duplicate's `b:<ref>` names the item it was merged into, so references written before the merge still resolve. */
  '5_alias_redirects': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE alias_redirects (alias TEXT PRIMARY KEY, target TEXT NOT NULL, created_at INTEGER NOT NULL)`
  }),
  /**
   * The order this Host stored each op in: what a peer's cursor counts, because an HLC stamp is no cursor once ops from
   * other Hosts arrive late with older stamps. `rowid` seeds it but cannot be the cursor itself: VACUUM may renumber it.
   */
  '6_op_sequence': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE ops ADD COLUMN seq INTEGER`
    yield* sql`UPDATE ops SET seq = rowid`
    yield* sql`CREATE UNIQUE INDEX ops_seq ON ops (seq)`
  }),
  /** Per multi-host runtime: the backlog Host behind it, how far its log was pulled, and how the last pull went. Local to this Host. */
  '7_peer_state': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE peer_state (
      runtime_id TEXT PRIMARY KEY,
      remote_host_id TEXT,
      cursor INTEGER NOT NULL DEFAULT 0,
      head INTEGER NOT NULL DEFAULT 0,
      pulled INTEGER NOT NULL DEFAULT 0,
      last_pull_at INTEGER,
      last_success_at INTEGER,
      last_error_code TEXT,
      last_error TEXT
    )`
  }),
}

/** The backlog's SQLite file, through the shared store layer (WAL, migrations, `BEGIN IMMEDIATE`). */
export class BacklogDb extends Context.Service<BacklogDb, SqlClient.SqlClient>()('@dshfiles/backlog/BacklogDb') {
  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const paths = yield* BacklogStorePaths
      return SqliteStore.layerAs(BacklogDb, { filename: paths.database, migrations: backlogMigrations })
    }),
  )
}
