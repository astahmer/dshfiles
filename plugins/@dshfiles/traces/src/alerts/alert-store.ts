import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { z } from 'zod'
import { initialAlertState } from './alert-evaluator.js'
import {
  alertEventSchema,
  alertRuleSchema,
  alertStateSchema,
  MAX_ALERT_RULES,
  type AlertEvent,
  type AlertRule,
  type AlertRuleDraft,
  type AlertState,
} from './alert-types.js'
import { DEFAULT_ALERT_RULES } from './default-rules.js'

const MIGRATIONS = [
  `
  CREATE TABLE rules (id TEXT PRIMARY KEY, position INTEGER NOT NULL, rule TEXT NOT NULL) WITHOUT ROWID;
  CREATE TABLE states (rule_id TEXT PRIMARY KEY, state TEXT NOT NULL) WITHOUT ROWID;
  CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id TEXT NOT NULL, at INTEGER NOT NULL, event TEXT NOT NULL);
  CREATE INDEX events_rule ON events (rule_id, id);
  `,
]

/** History is a bounded ring: the newest events across all rules. */
export const MAX_ALERT_EVENTS = 500

export class AlertStoreError extends Error {
  constructor(
    readonly code: 'not-found' | 'too-many-rules',
    message: string,
  ) {
    super(message)
    this.name = 'AlertStoreError'
  }
}

type NewEvent = Omit<AlertEvent, 'id'>

const ruleRowSchema = z.object({ rule: z.string() })
const stateRowSchema = z.object({ rule_id: z.string(), state: z.string() })
const eventRowSchema = z.object({ id: z.number(), event: z.string() })

const newRuleId = (): string => `rule-${randomBytes(5).toString('hex')}`

export type AlertStore = ReturnType<typeof openAlertStore>

/**
 * Rules, their current state and a bounded event history in their own SQLite file next to the span store, so alert
 * changes never migrate the telemetry tables. Built-in rules are seeded once, when the file is created; editing or
 * removing one sticks.
 */
export const openAlertStore = (options: { readonly path: string; readonly now?: () => number }) => {
  const now = options.now ?? Date.now
  if (options.path !== ':memory:') mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 })
  const database = new DatabaseSync(options.path)
  database.exec('PRAGMA busy_timeout = 5000')
  database.exec('PRAGMA journal_mode = WAL')
  const version = z.object({ user_version: z.number() }).parse(database.prepare('PRAGMA user_version').get()).user_version
  for (let index = version; index < MIGRATIONS.length; index++) {
    database.exec('BEGIN IMMEDIATE')
    database.exec(MIGRATIONS[index] ?? '')
    database.exec(`PRAGMA user_version = ${String(index + 1)}`)
    database.exec('COMMIT')
  }
  if (options.path !== ':memory:') for (const file of [options.path, `${options.path}-wal`, `${options.path}-shm`]) if (existsSync(file)) chmodSync(file, 0o600)

  const statements = new Map<string, StatementSync>()
  const prepare = (sql: string): StatementSync => {
    const cached = statements.get(sql)
    if (cached !== undefined) return cached
    const statement = database.prepare(sql)
    statements.set(sql, statement)
    return statement
  }

  const writeRule = (rule: AlertRule, position: number): void => {
    prepare('INSERT OR REPLACE INTO rules (id, position, rule) VALUES (?, ?, ?)').run(rule.id, position, JSON.stringify(alertRuleSchema.parse(rule)))
  }

  if (version === 0) {
    const seededAt = now()
    DEFAULT_ALERT_RULES.forEach((draft, index) => writeRule({ ...draft, mutedUntil: null, builtin: true, createdAt: seededAt, updatedAt: seededAt }, index))
  }

  const rules = (): AlertRule[] =>
    z
      .array(ruleRowSchema)
      .parse(prepare('SELECT rule FROM rules ORDER BY position, id').all())
      .map(row => alertRuleSchema.parse(JSON.parse(row.rule)))

  const rule = (id: string): AlertRule => {
    const row = prepare('SELECT rule FROM rules WHERE id = ?').get(id)
    if (row === undefined) throw new AlertStoreError('not-found', `No alert rule ${id}.`)
    return alertRuleSchema.parse(JSON.parse(ruleRowSchema.parse(row).rule))
  }

  const positionOf = (id: string): number => {
    const row = prepare('SELECT position FROM rules WHERE id = ?').get(id)
    if (row !== undefined) return z.object({ position: z.number() }).parse(row).position
    return z.object({ next: z.number().nullable() }).parse(prepare('SELECT MAX(position) + 1 AS next FROM rules').get()).next ?? 0
  }

  const save = (draft: AlertRuleDraft): AlertRule => {
    const at = now()
    if (draft.id === undefined) {
      if (rules().length >= MAX_ALERT_RULES) throw new AlertStoreError('too-many-rules', `At most ${String(MAX_ALERT_RULES)} alert rules are kept.`)
      const created: AlertRule = { ...draft, id: newRuleId(), mutedUntil: null, builtin: false, createdAt: at, updatedAt: at }
      writeRule(created, positionOf(created.id))
      return created
    }
    const existing = rule(draft.id)
    const updated: AlertRule = { ...existing, ...draft, id: existing.id, updatedAt: at }
    writeRule(updated, positionOf(updated.id))
    return updated
  }

  const setMutedUntil = (id: string, mutedUntil: number | null): AlertRule => {
    const updated: AlertRule = { ...rule(id), mutedUntil, updatedAt: now() }
    writeRule(updated, positionOf(id))
    return updated
  }

  const remove = (id: string): AlertRule => {
    const removed = rule(id)
    prepare('DELETE FROM rules WHERE id = ?').run(id)
    prepare('DELETE FROM states WHERE rule_id = ?').run(id)
    return removed
  }

  const states = (): Map<string, AlertState> =>
    new Map(
      z
        .array(stateRowSchema)
        .parse(prepare('SELECT rule_id, state FROM states').all())
        .map(row => [row.rule_id, alertStateSchema.parse(JSON.parse(row.state))]),
    )

  const stateOf = (id: string): AlertState => states().get(id) ?? initialAlertState

  const writeState = (id: string, state: AlertState): void => {
    prepare('INSERT OR REPLACE INTO states (rule_id, state) VALUES (?, ?)').run(id, JSON.stringify(alertStateSchema.parse(state)))
  }

  const clearState = (id: string): void => {
    prepare('DELETE FROM states WHERE rule_id = ?').run(id)
  }

  const appendEvent = (event: NewEvent): AlertEvent => {
    const parsed = alertEventSchema.omit({ id: true }).parse(event)
    const id = Number(prepare('INSERT INTO events (rule_id, at, event) VALUES (?, ?, ?)').run(parsed.ruleId, parsed.at, JSON.stringify(parsed)).lastInsertRowid)
    prepare('DELETE FROM events WHERE id <= ?').run(id - MAX_ALERT_EVENTS)
    return { ...parsed, id }
  }

  const eventsOf = (rows: readonly z.infer<typeof eventRowSchema>[]): AlertEvent[] =>
    rows.map(row => alertEventSchema.parse({ ...z.record(z.string(), z.unknown()).parse(JSON.parse(row.event)), id: row.id }))

  const history = (limit: number): AlertEvent[] =>
    eventsOf(z.array(eventRowSchema).parse(prepare('SELECT id, event FROM events ORDER BY id DESC LIMIT ?').all(limit)))

  const eventsAfter = (afterId: number, limit: number): AlertEvent[] =>
    eventsOf(z.array(eventRowSchema).parse(prepare('SELECT id, event FROM events WHERE id > ? ORDER BY id DESC LIMIT ?').all(afterId, limit)))

  const latestEventId = (): number => z.object({ id: z.number().nullable() }).parse(prepare('SELECT MAX(id) AS id FROM events').get()).id ?? 0

  return {
    rules,
    rule,
    save,
    setMutedUntil,
    remove,
    states,
    stateOf,
    writeState,
    clearState,
    appendEvent,
    history,
    eventsAfter,
    latestEventId,
    close: () => database.close(),
  }
}
