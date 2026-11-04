import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/** One schema step: its statements in order, inside the migration transaction. */
const migration = (script: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const statements = script
      .split(';')
      .map(statement => statement.trim())
      .filter(statement => statement.length > 0)
    yield* Effect.forEach(statements, statement => sql.unsafe(statement), { discard: true })
  })

/**
 * The steps the hand-rolled opener ran as `PRAGMA user_version` 1..8, verbatim: an existing usage.db is adopted at its
 * user_version without re-running them, a fresh one runs them in order.
 */
export const usageMigrations = {
  '0001_init': migration(`
  CREATE TABLE files (
    path TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    offset INTEGER NOT NULL,
    size INTEGER NOT NULL,
    mtime_ms REAL NOT NULL,
    state TEXT NOT NULL
  ) STRICT;

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    cwd TEXT,
    project TEXT,
    title TEXT,
    parent_session TEXT,
    subagent INTEGER NOT NULL,
    created_at INTEGER
  ) STRICT;

  CREATE TABLE requests (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    seq INTEGER,
    message_id TEXT,
    turn INTEGER,
    step INTEGER,
    purpose TEXT NOT NULL,
    source TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    ttft_ms INTEGER,
    input INTEGER,
    cache_read INTEGER,
    cache_write INTEGER,
    output INTEGER,
    reasoning INTEGER,
    band INTEGER NOT NULL,
    status TEXT NOT NULL,
    stop_reason TEXT,
    error_code TEXT,
    merged_into TEXT,
    settled INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX requests_started ON requests (started_at);
  CREATE INDEX requests_session ON requests (session_id, started_at);
  CREATE INDEX requests_unsettled ON requests (settled) WHERE settled = 0;

  CREATE TABLE route_rates (
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    band INTEGER NOT NULL,
    input REAL NOT NULL,
    output REAL NOT NULL,
    cache_read REAL NOT NULL,
    cache_write REAL NOT NULL,
    PRIMARY KEY (provider, model, band)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
  `),
  // Pricing reads the distinct routes that have usage; the partial index answers it without reading request rows.
  '0002_requests_route_band': migration(`CREATE INDEX requests_route_band ON requests (provider, model, band) WHERE input IS NOT NULL;`),
  '0003_jev_requests': migration(`
  CREATE TABLE jev_requests (
    request_id TEXT PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('backlog', 'memory')),
    started_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 0 AND 3600000),
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
    input_tokens INTEGER CHECK (input_tokens >= 0),
    output_tokens INTEGER CHECK (output_tokens >= 0)
  ) STRICT;
  CREATE INDEX jev_requests_started ON jev_requests (started_at);
  `),
  '0004_jev_requests_credential': migration(
    `ALTER TABLE jev_requests ADD COLUMN credential TEXT NOT NULL DEFAULT 'Legacy / unknown' CHECK (length(credential) BETWEEN 1 AND 400);`,
  ),
  '0005_tools': migration(`
  CREATE TABLE tools (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    turn INTEGER,
    step INTEGER,
    name TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'error', 'interrupted', 'unknown', 'pending')),
    category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('api', 'mcp', 'plugin', 'tool', 'skill', 'other')),
    owner TEXT
  ) STRICT;
  CREATE INDEX tools_started ON tools (started_at);
  CREATE INDEX tools_name_started ON tools (name, started_at);
  CREATE INDEX tools_category_started ON tools (category, started_at);
  CREATE INDEX tools_outcome_started ON tools (outcome, started_at);
  `),
  '0006_tools_normalized_command': migration(
    `ALTER TABLE tools ADD COLUMN normalized_command TEXT CHECK (normalized_command IS NULL OR length(normalized_command) BETWEEN 1 AND 80);`,
  ),
  '0007_tools_test_runner': migration(`ALTER TABLE tools ADD COLUMN test_runner TEXT CHECK (test_runner IS NULL OR length(test_runner) BETWEEN 1 AND 80);`),
  '0008_tools_result_chars': migration(
    `ALTER TABLE tools ADD COLUMN result_chars INTEGER CHECK (result_chars IS NULL OR result_chars BETWEEN 0 AND 100000000);`,
  ),
}

export const LEGACY_USER_VERSION = 8
