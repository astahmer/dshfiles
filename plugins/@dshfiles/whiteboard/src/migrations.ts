import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

const initialSchema = [
  `CREATE TABLE boards (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    title TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    scene_json TEXT NOT NULL,
    pending_json TEXT,
    element_count INTEGER NOT NULL CHECK (element_count >= 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`,
  'CREATE INDEX boards_by_project ON boards(project, deleted_at, updated_at DESC)',
]

export const whiteboardMigrations = {
  '1_initial': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* Effect.forEach(initialSchema, statement => sql.unsafe(statement), { discard: true })
  }),
}
