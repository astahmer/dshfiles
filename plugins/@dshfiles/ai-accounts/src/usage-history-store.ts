import { chmodSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import * as Schema from 'effect/Schema'
import { UsageHistoryModel } from './usage-history.js'
import { quotaSnapshotSchema, usageMetaSchema, type QuotaSnapshot, type UsageMeta } from './usage-history-model.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS quota (
  key TEXT PRIMARY KEY,
  instance_id TEXT,
  at REAL NOT NULL,
  snapshot TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS quota_by_instance ON quota (instance_id, at);
CREATE INDEX IF NOT EXISTS quota_by_at ON quota (at);
CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
`

// Same WAL bounds as `@dshfiles/sqlite-store`: 32 MB journal limit and a 1,000-page autocheckpoint.
const PRAGMAS = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA journal_size_limit = 33554432;
PRAGMA wal_autocheckpoint = 1000;
`

const SETTINGS = 'settings'
const JSON_IMPORTED = 'json-imported'

const decodeQuotaRow = Schema.decodeUnknownSync(Schema.Struct({ instance_id: Schema.String, snapshot: Schema.fromJsonString(quotaSnapshotSchema) }))
const decodeSettingsRow = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.fromJsonString(usageMetaSchema) }))

/**
 * Quota history in SQLite. The whole-unit JSON domain it replaces was parsed into the heap at boot (32k rows, ~41 MB)
 * and rewritten in full on every reading; here a sweep writes one row per account and a chart reads only its range.
 * The legacy JSON file is imported once and never written, so an older build still reads it.
 */
export class UsageHistoryStore {
  static readonly defaultFilename = (): string => join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'plugins', 'ai-accounts', 'usage-history.db')

  static readonly open = (filename: string): UsageHistoryStore => {
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })
    const db = new DatabaseSync(filename)
    try {
      db.exec(PRAGMAS)
      db.exec(SCHEMA)
      chmodSync(filename, 0o600)
      return new UsageHistoryStore(db)
    } catch (error) {
      db.close()
      throw error
    }
  }

  private readonly readMeta: StatementSync
  private readonly writeMeta: StatementSync
  private readonly upsertQuota: StatementSync
  private readonly insertQuotaIfAbsent: StatementSync
  private readonly deleteBefore: StatementSync
  private readonly selectRange: StatementSync

  private constructor(private readonly db: DatabaseSync) {
    this.readMeta = db.prepare('SELECT value FROM meta WHERE name = ?')
    this.writeMeta = db.prepare('INSERT INTO meta (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value')
    this.upsertQuota = db.prepare(
      'INSERT INTO quota (key, instance_id, at, snapshot) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET instance_id = excluded.instance_id, at = excluded.at, snapshot = excluded.snapshot',
    )
    this.insertQuotaIfAbsent = db.prepare('INSERT OR IGNORE INTO quota (key, instance_id, at, snapshot) VALUES (?, ?, ?, ?)')
    this.deleteBefore = db.prepare('DELETE FROM quota WHERE at < ?')
    this.selectRange = db.prepare('SELECT instance_id, snapshot FROM quota WHERE instance_id IN (SELECT value FROM json_each(?)) AND at >= ? ORDER BY at')
  }

  settings(): UsageMeta | undefined {
    const row = this.readMeta.get(SETTINGS)
    return row === undefined ? undefined : decodeSettingsRow(row).value
  }

  saveSettings(settings: UsageMeta): void {
    this.writeMeta.run(SETTINGS, JSON.stringify(settings))
  }

  put(key: string, snapshot: QuotaSnapshot): void {
    this.upsertQuota.run(key, UsageHistoryModel.parseBucketKey(key)?.instanceId ?? null, snapshot.at, JSON.stringify(snapshot))
  }

  /** Delete every reading taken before `cutoff`; the number deleted. */
  prune(cutoff: number): number {
    return Number(this.deleteBefore.run(cutoff).changes)
  }

  /** Readings of these accounts since `sinceMs`, oldest first, grouped by the account their key names. */
  read(instanceIds: readonly string[], sinceMs: number): ReadonlyMap<string, readonly QuotaSnapshot[]> {
    const grouped = new Map<string, QuotaSnapshot[]>()
    for (const raw of this.selectRange.all(JSON.stringify(instanceIds), sinceMs)) {
      const row = decodeQuotaRow(raw)
      const rows = grouped.get(row.instance_id) ?? []
      rows.push(row.snapshot)
      grouped.set(row.instance_id, rows)
    }
    return grouped
  }

  jsonImported(): boolean {
    return this.readMeta.get(JSON_IMPORTED) !== undefined
  }

  /** Copy the legacy JSON domain in one transaction; a reading or setting already written here wins over its JSON copy. */
  importJson(input: { readonly settings: UsageMeta; readonly rows: Iterable<readonly [string, QuotaSnapshot]> }): number {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      let imported = 0
      for (const [key, snapshot] of input.rows)
        imported += Number(
          this.insertQuotaIfAbsent.run(key, UsageHistoryModel.parseBucketKey(key)?.instanceId ?? null, snapshot.at, JSON.stringify(snapshot)).changes,
        )
      if (this.settings() === undefined) this.saveSettings(input.settings)
      this.writeMeta.run(JSON_IMPORTED, JSON.stringify({ rows: imported }))
      this.db.exec('COMMIT')
      return imported
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    this.db.close()
  }
}
