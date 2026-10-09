import type { DatabaseSync } from 'node:sqlite'

/** Ordered and append-only: index + 1 is the `PRAGMA user_version` a migration leaves behind. */
const migrations: readonly string[] = [
  `
  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    event_key TEXT NOT NULL UNIQUE,
    harness TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    project_id TEXT,
    parent_conversation_id TEXT,
    role TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    text TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    truncated INTEGER NOT NULL,
    meta TEXT NOT NULL
  ) STRICT;
  CREATE INDEX events_conversation ON events (conversation_id, id);
  CREATE INDEX events_project ON events (project_id, id);

  CREATE TABLE stream_entries (
    stream TEXT NOT NULL,
    pos INTEGER NOT NULL,
    event_id INTEGER NOT NULL REFERENCES events (id),
    PRIMARY KEY (stream, pos)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX stream_entries_event ON stream_entries (event_id);

  CREATE TABLE nodes (
    stream TEXT NOT NULL,
    level INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    text TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    event_id INTEGER REFERENCES events (id),
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (stream, level, idx)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX nodes_event ON nodes (event_id) WHERE event_id IS NOT NULL;

  CREATE TABLE views (
    stream TEXT PRIMARY KEY,
    through_pos INTEGER NOT NULL,
    nodes TEXT NOT NULL,
    rendered TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    version INTEGER NOT NULL,
    merge_pending INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE cursors (
    name TEXT NOT NULL,
    stream TEXT NOT NULL,
    pos INTEGER NOT NULL,
    PRIMARY KEY (name, stream)
  ) STRICT;

  CREATE VIRTUAL TABLE events_fts USING fts5 (text, content = 'events', content_rowid = 'id', tokenize = 'unicode61');
  `,
  `
  CREATE TABLE views_by_kind (
    stream TEXT NOT NULL,
    kind TEXT NOT NULL,
    through_pos INTEGER NOT NULL,
    nodes TEXT NOT NULL,
    rendered TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    version INTEGER NOT NULL,
    merge_pending INTEGER NOT NULL,
    PRIMARY KEY (stream, kind)
  ) STRICT, WITHOUT ROWID;
  INSERT INTO views_by_kind (stream, kind, through_pos, nodes, rendered, bytes, version, merge_pending)
    SELECT stream, 'main', through_pos, nodes, rendered, bytes, version, merge_pending FROM views;
  DROP TABLE views;
  ALTER TABLE views_by_kind RENAME TO views;
  `,
]

export const migrate = (database: DatabaseSync): void => {
  const row = database.prepare('PRAGMA user_version').get()
  const current = typeof row?.['user_version'] === 'number' ? row['user_version'] : 0
  for (let version = current; version < migrations.length; version++) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrations[version] ?? '')
      database.exec(`PRAGMA user_version = ${version + 1}`)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
}
