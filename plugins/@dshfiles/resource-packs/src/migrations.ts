import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/** The hand-rolled opener's `user_version = 1` script, verbatim, so adopted and fresh files hold the same schema. */
const initialSchema = `
        CREATE TABLE packs (id TEXT PRIMARY KEY, json TEXT NOT NULL);
        CREATE TABLE resources (
          id TEXT PRIMARY KEY, provider TEXT NOT NULL, kind TEXT NOT NULL, native_id TEXT NOT NULL,
          label TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision > 0), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          UNIQUE (provider, kind, native_id)
        );
        CREATE TABLE attachments (
          resource_id TEXT NOT NULL REFERENCES resources(id), pack_id TEXT NOT NULL REFERENCES packs(id),
          values_json TEXT NOT NULL, attached INTEGER NOT NULL CHECK (attached IN (0, 1)), PRIMARY KEY (resource_id, pack_id)
        );
        CREATE TABLE events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, resource_id TEXT NOT NULL REFERENCES resources(id), revision INTEGER NOT NULL,
          json TEXT NOT NULL, UNIQUE (resource_id, revision)
        );
        CREATE INDEX resource_events ON events(resource_id, sequence DESC);
        CREATE INDEX attached_packs ON attachments(pack_id, attached, resource_id);
`

export const resourcePacksMigrations = {
  '1_initial': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const statements = initialSchema
      .split(';')
      .map(statement => statement.trim())
      .filter(statement => statement.length > 0)
    yield* Effect.forEach(statements, statement => sql.unsafe(statement), { discard: true })
  }),
}
