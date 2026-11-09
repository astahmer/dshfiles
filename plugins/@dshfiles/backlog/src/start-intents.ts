import { Context, Effect, Layer, Option, Ref, Schema } from 'effect'
import { SqlClient, SqlSchema } from 'effect/sql'
import { BacklogDb } from './backlog-db.js'
import type { BacklogActor } from './store.js'

/**
 * A thread start that outlives the request that asked for it: written before the Session exists, refreshed after every
 * step, removed once the thread is prompted and linked. A Host that dies inside the create → model → rename → prompt →
 * link sequence leaves one row behind, and the recovery sweep finishes it on the next boot.
 */
export interface StartIntentCreate {
  readonly workspaceId?: string | undefined
  readonly cwd?: string | undefined
}

export interface StartIntentRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string | undefined
}

export interface StartIntentDraft {
  readonly id: string
  /** Minted once, so a retried prompt stays the same logical message. */
  readonly promptRequestId: string
  readonly itemIds: readonly number[]
  readonly agent: string | null
  readonly agentPreset: string | null
  readonly create: StartIntentCreate
  readonly route: StartIntentRoute | null
  /** The caller's raw message; null means the item's own start message. */
  readonly message: string | null
  /** Who asked for this start, kept so a resumed link keeps the same actor and provenance. */
  readonly actor: BacklogActor
}

export interface StartIntent extends StartIntentDraft {
  readonly createdAt: number
  readonly updatedAt: number
  readonly sessionId: string | null
  readonly attempts: number
  readonly lastError: string | null
}

const createJson = Schema.fromJsonString(Schema.Struct({ workspaceId: Schema.optional(Schema.String), cwd: Schema.optional(Schema.String) }))
const routeJson = Schema.fromJsonString(Schema.Struct({ provider: Schema.String, model: Schema.String, reasoningEffort: Schema.optional(Schema.String) }))
const itemsJson = Schema.fromJsonString(Schema.Array(Schema.Number))
const actorJson = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal('user') }),
    Schema.Struct({ kind: Schema.Literal('system') }),
    Schema.Struct({ kind: Schema.Literal('agent'), sessionId: Schema.optional(Schema.String), cwd: Schema.optional(Schema.String) }),
  ]),
)

const Row = Schema.Struct({
  intent_id: Schema.String,
  created_at: Schema.Number,
  updated_at: Schema.Number,
  session_id: Schema.NullOr(Schema.String),
  prompt_request_id: Schema.String,
  items: Schema.String,
  agent: Schema.NullOr(Schema.String),
  agent_preset: Schema.NullOr(Schema.String),
  placement: Schema.String,
  route: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
  actor: Schema.String,
  attempts: Schema.Number,
  last_error: Schema.NullOr(Schema.String),
})

export class StartIntentFailed extends Schema.TaggedError<StartIntentFailed>()('StartIntentFailed', {
  operation: Schema.Literals(['record', 'touch', 'session', 'attempt', 'remove', 'read']),
  intentId: Schema.optionalKey(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `The backlog could not record the thread start it was resuming. Retry; if it keeps failing, check the Host log for the storage error.`
  }
}

const decodeRow = (row: typeof Row.Type) =>
  Effect.gen(function* () {
    const items = yield* Schema.decodeUnknownEffect(itemsJson)(row.items)
    const create = yield* Schema.decodeUnknownEffect(createJson)(row.placement)
    const route = row.route === null ? null : yield* Schema.decodeUnknownEffect(routeJson)(row.route)
    const actor = yield* Schema.decodeUnknownEffect(actorJson)(row.actor)
    return {
      id: row.intent_id,
      promptRequestId: row.prompt_request_id,
      itemIds: items,
      agent: row.agent,
      agentPreset: row.agent_preset,
      create,
      route,
      message: row.message,
      actor,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sessionId: row.session_id,
      attempts: row.attempts,
      lastError: row.last_error,
    } satisfies StartIntent
  })

/** The rows one recovery pass may take: every intent nobody has refreshed for `staleMs`. */
export const startIntentsStale = (input: {
  readonly sql: SqlClient.SqlClient
  readonly before: number
  readonly limit: number
}): Effect.Effect<readonly StartIntent[], StartIntentFailed> =>
  SqlSchema.findAll({
    Request: Schema.Struct({ before: Schema.Number, limit: Schema.Number }),
    Result: Row,
    execute: query => input.sql`SELECT * FROM start_intents WHERE updated_at <= ${query.before} ORDER BY created_at LIMIT ${query.limit}`,
  })({ before: input.before, limit: input.limit }).pipe(
    Effect.flatMap(rows => Effect.forEach(rows, row => decodeRow(row), { concurrency: 1 })),
    Effect.mapError(cause => new StartIntentFailed({ operation: 'read', cause })),
  )

/**
 * The durable start log. Every write is best-effort from the caller's side: a Host that cannot record an intent still
 * starts the thread, it just cannot finish that thread after a crash.
 */
export class StartIntents extends Context.Service<
  StartIntents,
  {
    readonly record: (draft: StartIntentDraft, now: number) => Effect.Effect<void, StartIntentFailed>
    readonly touch: (id: string, now: number) => Effect.Effect<void, StartIntentFailed>
    readonly setSession: (id: string, sessionId: string, now: number) => Effect.Effect<void, StartIntentFailed>
    readonly attempted: (input: {
      readonly id: string
      readonly attempts: number
      readonly lastError: string
      readonly now: number
    }) => Effect.Effect<void, StartIntentFailed>
    readonly remove: (id: string) => Effect.Effect<void, StartIntentFailed>
    readonly find: (id: string) => Effect.Effect<StartIntent | null, StartIntentFailed>
    readonly stale: (input: { readonly before: number; readonly limit: number }) => Effect.Effect<readonly StartIntent[], StartIntentFailed>
  }
>()('@dshfiles/backlog/StartIntents') {
  static readonly layer = Layer.effect(
    StartIntents,
    Effect.gen(function* () {
      const sql = yield* BacklogDb
      const failed = (operation: StartIntentFailed['operation'], intentId?: string) => (cause: unknown) =>
        intentId === undefined ? new StartIntentFailed({ operation, cause }) : new StartIntentFailed({ operation, intentId, cause })

      const record = Effect.fn('backlog start intent record')(function* (draft: StartIntentDraft, now: number) {
        const items = yield* Schema.encodeEffect(itemsJson)(draft.itemIds)
        const placement = yield* Schema.encodeEffect(createJson)(draft.create)
        const route = draft.route === null ? null : yield* Schema.encodeEffect(routeJson)(draft.route)
        const actor = yield* Schema.encodeEffect(actorJson)(draft.actor)
        yield* sql`INSERT INTO start_intents (
          intent_id, created_at, updated_at, session_id, prompt_request_id, items, agent, agent_preset, placement, route, message, actor, attempts, last_error
        ) VALUES (
          ${draft.id}, ${now}, ${now}, NULL, ${draft.promptRequestId}, ${items}, ${draft.agent}, ${draft.agentPreset}, ${placement}, ${route}, ${draft.message}, ${actor}, 0, NULL
        )`
      })

      const find = Effect.fn('backlog start intent read')(function* (id: string) {
        const found = yield* SqlSchema.findOneOption({
          Request: Schema.String,
          Result: Row,
          execute: intentId => sql`SELECT * FROM start_intents WHERE intent_id = ${intentId}`,
        })(id)
        return yield* Option.match(found, { onNone: () => Effect.succeed(null), onSome: row => decodeRow(row) })
      })

      return StartIntents.of({
        record: (draft, now) => record(draft, now).pipe(Effect.mapError(failed('record', draft.id))),
        touch: (id, now) => sql`UPDATE start_intents SET updated_at = ${now} WHERE intent_id = ${id}`.pipe(Effect.mapError(failed('touch', id))),
        setSession: (id, sessionId, now) =>
          sql`UPDATE start_intents SET session_id = ${sessionId}, updated_at = ${now} WHERE intent_id = ${id}`.pipe(Effect.mapError(failed('session', id))),
        attempted: input =>
          sql`UPDATE start_intents SET attempts = ${input.attempts}, last_error = ${input.lastError}, updated_at = ${input.now} WHERE intent_id = ${input.id}`.pipe(
            Effect.mapError(failed('attempt', input.id)),
          ),
        remove: id => sql`DELETE FROM start_intents WHERE intent_id = ${id}`.pipe(Effect.mapError(failed('remove', id))),
        find: id => find(id).pipe(Effect.mapError(failed('read', id))),
        stale: input => startIntentsStale({ sql, before: input.before, limit: input.limit }),
      })
    }),
  )
}

/**
 * The starts this Host process is running right now. The recovery sweep skips them, so a slow attachment upload inside a
 * live start is never resumed a second time.
 */
export class StartIntentClaims extends Context.Service<
  StartIntentClaims,
  {
    readonly hold: <A, E, R>(id: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
    readonly held: (id: string) => Effect.Effect<boolean>
  }
>()('@dshfiles/backlog/StartIntentClaims') {
  static readonly layer = Layer.effect(
    StartIntentClaims,
    Effect.gen(function* () {
      const ids = yield* Ref.make<ReadonlySet<string>>(new Set())
      const add = (id: string) => Ref.update(ids, current => new Set(current).add(id))
      const drop = (id: string) => Ref.update(ids, current => new Set([...current].filter(entry => entry !== id)))
      return StartIntentClaims.of({
        hold: (id, effect) =>
          Effect.acquireUseRelease(
            add(id),
            () => effect,
            () => drop(id),
          ),
        held: id => Effect.map(Ref.get(ids), current => current.has(id)),
      })
    }),
  )
}
