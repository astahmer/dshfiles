import { randomBytes } from 'node:crypto'
import { SqliteStore, type SqliteStoreMigrations } from '@dshfiles/sqlite-store'
import { Clock, Context, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient, SqlSchema } from 'effect/sql'
import { orDieOnStorage } from '../storage-failure.js'
import { initialAlertState } from './alert-evaluator.js'
import {
  alertEventPayloadSchema,
  alertRuleSchema,
  alertStateSchema,
  MAX_ALERT_RULES,
  type AlertEvent,
  type AlertRule,
  type AlertRuleDraft,
  type AlertState,
} from './alert-types.js'
import { DEFAULT_ALERT_RULES } from './default-rules.js'

/** History is a bounded ring: the newest events across all rules. */
export const MAX_ALERT_EVENTS = 500

const ruleJson = Schema.fromJsonString(alertRuleSchema)
const stateJson = Schema.fromJsonString(alertStateSchema)
const eventJson = Schema.fromJsonString(alertEventPayloadSchema)
const encodeRule = Schema.encodeEffect(ruleJson)
const encodeState = Schema.encodeEffect(stateJson)

const writeRuleWith = Effect.fnUntraced(function* (sql: SqlClient.SqlClient, rule: AlertRule, position: number) {
  const encoded = yield* encodeRule(rule)
  yield* sql`INSERT OR REPLACE INTO rules (id, position, rule) VALUES (${rule.id}, ${position}, ${encoded})`
})

/** Built-in rules are seeded by the migration that creates the file, so editing or removing one sticks. */
const createAndSeed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE rules (id TEXT PRIMARY KEY, position INTEGER NOT NULL, rule TEXT NOT NULL) WITHOUT ROWID`
  yield* sql`CREATE TABLE states (rule_id TEXT PRIMARY KEY, state TEXT NOT NULL) WITHOUT ROWID`
  yield* sql`CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id TEXT NOT NULL, at INTEGER NOT NULL, event TEXT NOT NULL)`
  yield* sql`CREATE INDEX events_rule ON events (rule_id, id)`
  const seededAt = yield* Clock.currentTimeMillis
  yield* Effect.forEach(
    DEFAULT_ALERT_RULES,
    (draft, index) => writeRuleWith(sql, { ...draft, mutedUntil: null, builtin: true, createdAt: seededAt, updatedAt: seededAt }, index),
    { discard: true },
  )
})

/**
 * A long turn that ended successfully is expected here, so the seeded long-turn rule is corrected to off on a file that
 * still carries it unedited (equal timestamps); an edited one is the user's choice and stays as it is.
 */
const disableSeededLongTurn = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const correctedAt = yield* Clock.currentTimeMillis
  yield* sql`UPDATE rules SET rule = json_set(rule, '$.enabled', json('false'), '$.updatedAt', ${correctedAt})
    WHERE id = 'builtin-long-turn'
      AND json_extract(rule, '$.enabled') = 1
      AND json_extract(rule, '$.updatedAt') = json_extract(rule, '$.createdAt')`
})

export const ALERT_MIGRATIONS = { '1_rules': createAndSeed, '2_seeded_long_turn_off': disableSeededLongTurn } as const satisfies SqliteStoreMigrations

/** Rules, their current state and a bounded event history, in their own file so alert changes never migrate the telemetry tables. */
export class AlertDb extends Context.Service<AlertDb, SqlClient.SqlClient>()('@dshfiles/traces/AlertDb') {
  static readonly layerAt = (filename: string) =>
    SqliteStore.layerAs(AlertDb, { filename, migrations: ALERT_MIGRATIONS, legacyUserVersion: 1, pragmas: { synchronous: 'full' } })
}

export class AlertRuleNotFound extends Schema.TaggedError<AlertRuleNotFound>()('AlertRuleNotFound', { id: Schema.String }, { dshxWireCode: 'not-found' }) {
  override get message(): string {
    return `No alert rule ${this.id}.`
  }
}

export class AlertRuleLimitReached extends Schema.TaggedError<AlertRuleLimitReached>()(
  'AlertRuleLimitReached',
  { limit: Schema.Int },
  { dshxWireCode: 'too-many-rules' },
) {
  override get message(): string {
    return `At most ${String(this.limit)} alert rules are kept.`
  }
}

type NewEvent = Omit<AlertEvent, 'id'>

const ruleRow = Schema.Struct({ rule: ruleJson })
const stateRow = Schema.Struct({ rule_id: Schema.String, state: stateJson })
const eventRow = Schema.Struct({ id: Schema.Int, event: eventJson })
const positionRow = Schema.Struct({ position: Schema.Int })
const nextPositionRow = Schema.Struct({ next: Schema.NullOr(Schema.Int) })
const latestEventRow = Schema.Struct({ id: Schema.NullOr(Schema.Int) })
const insertedRow = Schema.Struct({ id: Schema.Int })

const newRuleId = (): string => `rule-${randomBytes(5).toString('hex')}`

const eventOf = (row: Schema.Schema.Type<typeof eventRow>): AlertEvent => ({ id: row.id, ...row.event })

const make = Effect.gen(function* () {
  const sql = yield* AlertDb

  const allRules = SqlSchema.findAll({ Request: Schema.Void, Result: ruleRow, execute: () => sql`SELECT rule FROM rules ORDER BY position, id` })
  const ruleById = SqlSchema.findOneOption({ Request: Schema.String, Result: ruleRow, execute: id => sql`SELECT rule FROM rules WHERE id = ${id}` })
  const positionById = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: positionRow,
    execute: id => sql`SELECT position FROM rules WHERE id = ${id}`,
  })
  const nextPosition = SqlSchema.findOne({ Request: Schema.Void, Result: nextPositionRow, execute: () => sql`SELECT MAX(position) + 1 AS next FROM rules` })
  const allStates = SqlSchema.findAll({ Request: Schema.Void, Result: stateRow, execute: () => sql`SELECT rule_id, state FROM states` })
  const newestEvents = SqlSchema.findAll({
    Request: Schema.Number,
    Result: eventRow,
    execute: limit => sql`SELECT id, event FROM events ORDER BY id DESC LIMIT ${limit}`,
  })
  const eventsAfterId = SqlSchema.findAll({
    Request: Schema.Struct({ afterId: Schema.Number, limit: Schema.Number }),
    Result: eventRow,
    execute: request => sql`SELECT id, event FROM events WHERE id > ${request.afterId} ORDER BY id DESC LIMIT ${request.limit}`,
  })
  const latestEvent = SqlSchema.findOne({ Request: Schema.Void, Result: latestEventRow, execute: () => sql`SELECT MAX(id) AS id FROM events` })
  const lastInserted = SqlSchema.findOne({ Request: Schema.Void, Result: insertedRow, execute: () => sql`SELECT last_insert_rowid() AS id` })

  const rulesNow = Effect.map(allRules(undefined), rows => rows.map(row => row.rule))

  const ruleNow = Effect.fnUntraced(function* (id: string) {
    const row = yield* ruleById(id)
    if (Option.isNone(row)) return yield* new AlertRuleNotFound({ id })
    return row.value.rule
  })

  const positionOf = Effect.fnUntraced(function* (id: string) {
    const existing = yield* positionById(id)
    if (Option.isSome(existing)) return existing.value.position
    return (yield* nextPosition(undefined)).next ?? 0
  })

  const writeRule = Effect.fnUntraced(function* (rule: AlertRule) {
    yield* writeRuleWith(sql, rule, yield* positionOf(rule.id))
  })

  const statesNow = Effect.map(allStates(undefined), rows => new Map(rows.map(row => [row.rule_id, row.state])))

  const rules = Effect.fn('alert repo rules')(function* () {
    return yield* rulesNow
  }, orDieOnStorage)

  const rule = Effect.fn('alert repo rule')(function* (id: string) {
    return yield* ruleNow(id)
  }, orDieOnStorage)

  const save = Effect.fn('alert repo save')(function* (draft: AlertRuleDraft) {
    const at = yield* Clock.currentTimeMillis
    if (draft.id === undefined) {
      if ((yield* rulesNow).length >= MAX_ALERT_RULES) return yield* new AlertRuleLimitReached({ limit: MAX_ALERT_RULES })
      const created: AlertRule = { ...draft, id: newRuleId(), mutedUntil: null, builtin: false, createdAt: at, updatedAt: at }
      yield* writeRule(created)
      return created
    }
    const existing = yield* ruleNow(draft.id)
    const updated: AlertRule = { ...existing, ...draft, id: existing.id, updatedAt: at }
    yield* writeRule(updated)
    return updated
  }, orDieOnStorage)

  const setMutedUntil = Effect.fn('alert repo set muted until')(function* (id: string, mutedUntil: number | null) {
    const updated: AlertRule = { ...(yield* ruleNow(id)), mutedUntil, updatedAt: yield* Clock.currentTimeMillis }
    yield* writeRule(updated)
    return updated
  }, orDieOnStorage)

  const remove = Effect.fn('alert repo remove')(function* (id: string) {
    const removed = yield* ruleNow(id)
    yield* sql`DELETE FROM rules WHERE id = ${id}`
    yield* sql`DELETE FROM states WHERE rule_id = ${id}`
    return removed
  }, orDieOnStorage)

  const states = Effect.fn('alert repo states')(function* () {
    return yield* statesNow
  }, orDieOnStorage)

  const stateOf = Effect.fn('alert repo state of')(function* (id: string) {
    return (yield* statesNow).get(id) ?? initialAlertState
  }, orDieOnStorage)

  const writeState = Effect.fn('alert repo write state')(function* (id: string, state: AlertState) {
    const encoded = yield* encodeState(state)
    yield* sql`INSERT OR REPLACE INTO states (rule_id, state) VALUES (${id}, ${encoded})`
  }, orDieOnStorage)

  const clearState = Effect.fn('alert repo clear state')(function* (id: string) {
    yield* sql`DELETE FROM states WHERE rule_id = ${id}`
  }, orDieOnStorage)

  const appendEvent = Effect.fn('alert repo append event')(function* (event: NewEvent) {
    const payload = yield* Schema.decodeUnknownEffect(alertEventPayloadSchema)(event)
    const encoded = yield* Schema.encodeEffect(eventJson)(payload)
    yield* sql`INSERT INTO events (rule_id, at, event) VALUES (${payload.ruleId}, ${payload.at}, ${encoded})`
    const id = (yield* lastInserted(undefined)).id
    yield* sql`DELETE FROM events WHERE id <= ${id - MAX_ALERT_EVENTS}`
    return { ...payload, id } satisfies AlertEvent
  }, orDieOnStorage)

  const history = Effect.fn('alert repo history')(function* (limit: number) {
    return (yield* newestEvents(limit)).map(eventOf)
  }, orDieOnStorage)

  const eventsAfter = Effect.fn('alert repo events after')(function* (afterId: number, limit: number) {
    return (yield* eventsAfterId({ afterId, limit })).map(eventOf)
  }, orDieOnStorage)

  const latestEventId = Effect.fn('alert repo latest event id')(function* () {
    return (yield* latestEvent(undefined)).id ?? 0
  }, orDieOnStorage)

  return AlertRepo.of({ rules, rule, save, setMutedUntil, remove, states, stateOf, writeState, clearState, appendEvent, history, eventsAfter, latestEventId })
})

export class AlertRepo extends Context.Service<
  AlertRepo,
  {
    readonly rules: () => Effect.Effect<AlertRule[]>
    readonly rule: (id: string) => Effect.Effect<AlertRule, AlertRuleNotFound>
    readonly save: (draft: AlertRuleDraft) => Effect.Effect<AlertRule, AlertRuleNotFound | AlertRuleLimitReached>
    readonly setMutedUntil: (id: string, mutedUntil: number | null) => Effect.Effect<AlertRule, AlertRuleNotFound>
    readonly remove: (id: string) => Effect.Effect<AlertRule, AlertRuleNotFound>
    readonly states: () => Effect.Effect<Map<string, AlertState>>
    readonly stateOf: (id: string) => Effect.Effect<AlertState>
    readonly writeState: (id: string, state: AlertState) => Effect.Effect<void>
    readonly clearState: (id: string) => Effect.Effect<void>
    readonly appendEvent: (event: NewEvent) => Effect.Effect<AlertEvent>
    readonly history: (limit: number) => Effect.Effect<AlertEvent[]>
    readonly eventsAfter: (afterId: number, limit: number) => Effect.Effect<AlertEvent[]>
    readonly latestEventId: () => Effect.Effect<number>
  }
>()('@dshfiles/traces/AlertRepo') {
  static readonly layer = Layer.effect(AlertRepo, make)
}
