import { SqliteStore } from '@dshfiles/sqlite-store'
import { Cause, Context, Effect, Layer, Schema } from 'effect'
import { SqlClient, SqlSchema } from 'effect/sql'
import { MemoryInactive } from './errors.ts'

const schema = `
create table if not exists threads (
  id text primary key,
  project text not null,
  parent text,
  title text not null,
  decision text not null,
  digest text not null,
  digest_hash text not null,
  source text not null,
  last_seq integer not null,
  updated_at integer not null,
  digested_at integer not null,
  duplicate_of text,
  uses integer not null default 0,
  last_used_at integer
);
create index if not exists threads_project on threads (project, updated_at desc);
create index if not exists threads_hash on threads (project, digest_hash);
create table if not exists notes (
  id integer primary key,
  project text not null,
  scope text not null,
  category text not null,
  confidence text not null,
  text text not null,
  hash text not null,
  source_thread text,
  source_seq integer,
  origin text not null default 'agent',
  first_created_at integer not null default 0,
  created_at integer not null,
  valid integer not null default 1,
  supersedes integer,
  superseded_by integer,
  forgotten_at integer,
  reason text,
  uses integer not null default 0,
  last_used_at integer,
  archived_at integer
);
create index if not exists notes_project on notes (project, valid, created_at desc);
create virtual table if not exists docs_words using fts5 (text, kind unindexed, ref unindexed, project unindexed, tokenize = 'porter unicode61 remove_diacritics 2');
create virtual table if not exists docs_ids using fts5 (text, kind unindexed, ref unindexed, project unindexed, tokenize = 'trigram');
create virtual table if not exists messages_words using fts5 (text, content = '', contentless_delete = 1, tokenize = 'porter unicode61 remove_diacritics 2');
create virtual table if not exists messages_ids using fts5 (text, content = '', contentless_delete = 1, tokenize = 'trigram');
create table if not exists messages (
  rowid integer primary key,
  thread text not null,
  seq integer not null,
  project text not null,
  role text not null,
  at integer not null,
  excerpt text,
  unique (thread, seq)
);
create index if not exists messages_at on messages (at);
create table if not exists indexed_threads (thread text primary key, through_seq integer not null);
create table if not exists thread_blocks (thread text primary key, text text not null, created_at integer not null);
create table if not exists embeddings (kind text not null, ref text not null, model text not null, project text not null, updated_at integer not null, vector blob not null, primary key (kind, ref, model));
create table if not exists tool_calls (id integer primary key, at integer not null, thread text not null, tool text not null, results integer not null, used integer not null default 0, tokens text not null);
create index if not exists tool_calls_thread on tool_calls (thread, at);
create table if not exists counters (name text primary key, value integer not null);
create table if not exists citations (
  id integer primary key,
  at integer not null,
  thread text not null,
  ref text not null,
  rating text,
  agent_corrected integer not null default 0,
  user_corrected integer not null default 0
);
create table if not exists costs (at integer not null, kind text not null, provider text not null, model text not null, input integer not null, cache_read integer not null, output integer not null);
create index if not exists costs_at on costs (at);
create table if not exists daily (day text not null, name text not null, value integer not null, primary key (day, name));
create index if not exists citations_at on citations (at);
`

const script = (text: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    for (const statement of text.split(';').map(part => part.trim())) if (statement.length > 0) yield* sql.unsafe(statement)
  })

const ColumnName = Schema.Struct({ name: Schema.String })

/** Files written before the column existed get it; files that have it are left alone, so the step runs once everywhere. */
const addColumnIfMissing = (input: { readonly table: string; readonly column: string; readonly type: string }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const columns = yield* SqlSchema.findAll({
      Request: Schema.String,
      Result: ColumnName,
      execute: table => sql`select name from pragma_table_info(${table})`,
    })(input.table)
    if (columns.some(column => column.name === input.column)) return
    yield* sql.unsafe(`alter table ${input.table} add column ${input.column} ${input.type}`)
  })

/**
 * The opener kept no version: the first steps rerun its `create ... if not exists` script and column probes once
 * against files that already hold them, so adopted and fresh files end with the same schema.
 */
export const memoryMigrations = {
  '1_initial_schema': script(schema),
  '2_message_excerpt': addColumnIfMissing({ table: 'messages', column: 'excerpt', type: 'text' }),
  '3_note_archive': addColumnIfMissing({ table: 'notes', column: 'archived_at', type: 'integer' }),
  '4_active_note_hash': script(
    'drop index if exists notes_valid_hash; create unique index if not exists notes_active_hash on notes (project, hash) where valid = 1 and archived_at is null',
  ),
}

/** Memory's SQLite file, or why it could not be opened: memory stays off and says so instead of failing activation. */
export class MemoryDb extends Context.Service<MemoryDb, { readonly sql: Effect.Effect<SqlClient.SqlClient, MemoryInactive> }>()('@dshfiles/memory/MemoryDb') {
  static readonly layer = (filename: string) =>
    Layer.effect(
      MemoryDb,
      Effect.map(SqlClient.SqlClient, sql => MemoryDb.of({ sql: Effect.succeed(sql) })),
    ).pipe(
      Layer.provide(SqliteStore.layer({ filename, migrations: memoryMigrations, pragmas: { synchronous: 'full' } })),
      Layer.catchCause(cause => {
        const squashed = Cause.squash(cause)
        const failure = new MemoryInactive({ reason: squashed instanceof Error ? squashed.message : 'the store could not be opened', cause })
        return Layer.effect(
          MemoryDb,
          Effect.logWarning('memory: the store could not be opened; memory is off', cause).pipe(Effect.as(MemoryDb.of({ sql: Effect.fail(failure) }))),
        )
      }),
    )
}
