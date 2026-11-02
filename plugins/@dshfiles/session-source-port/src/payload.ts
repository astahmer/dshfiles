export * as SessionPayload from './payload.js'

import type {
  SessionCancelValue,
  SessionFollowFrame,
  SessionPage,
  SessionProjectionsValue,
  SessionPromptValue,
  SessionSelectModelValue,
  SessionSummary,
  SessionUpdateQueueValue,
} from '@deepseek-ai/dsh-api-session-controller/types'
import { Effect, Result, Schema } from 'effect'

const payloadKinds = ['summaries', 'follow-frame', 'page', 'projections', 'prompt', 'cancel', 'selected-model', 'queue'] as const

/** A remote runtime answered with a payload this Host cannot read; `cause` holds the schema issue. */
export class SessionPayloadError extends Schema.TaggedError<SessionPayloadError>()('SessionPayloadError', {
  payload: Schema.Literals(payloadKinds),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `The remote runtime sent an unreadable session ${this.payload} payload. Update DSH on that machine, then reconnect.`
  }
}

const boundedString = (minimum: number, maximum: number) => Schema.String.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum))

/** One runtime's payload keeps every field it sent; only the fields this Host reads are named. */
const passthrough = <Shape extends Schema.StructWithRest.Objects>(shape: Shape) => Schema.StructWithRest(shape, [Schema.Record(Schema.String, Schema.Unknown)])

export const sessionSummarySchema = passthrough(
  Schema.Struct({
    sessionId: boundedString(1, 256),
    updatedAt: Schema.Number,
    running: Schema.Boolean,
    blank: Schema.Boolean,
    agentAvailable: Schema.Boolean,
    cwd: Schema.optionalKey(Schema.String),
    parentSessionId: Schema.optionalKey(Schema.String),
    origin: Schema.optionalKey(Schema.Literal('subagent')),
    formatStatus: Schema.optionalKey(Schema.Literals(['current', 'migration-required'])),
    projections: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  }),
)
export const sessionListSchema = passthrough(Schema.Struct({ items: Schema.Array(sessionSummarySchema).check(Schema.isMaxLength(10_000)) }))
export const sessionFollowFrameSchema = passthrough(Schema.Struct({ type: Schema.Literals(['snapshot', 'event', 'assistant-stream']) }))
export const sessionPageSchema = passthrough(
  Schema.Struct({ records: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(10_000)), hasMore: Schema.Boolean }),
)
const acceptedSchema = passthrough(Schema.Struct({ accepted: Schema.Literal(true) }))
const modelSelectionSchema = passthrough(Schema.Struct({ provider: Schema.String, model: Schema.String, reasoningEffort: Schema.optionalKey(Schema.String) }))
export const sessionSelectModelSchema = passthrough(Schema.Struct({ selected: modelSelectionSchema }))
export const sessionProjectionsSchema = Schema.Union([
  Schema.Null,
  passthrough(Schema.Struct({ kind: Schema.Literal('sequenced'), asOfSeq: Schema.Number })),
  passthrough(Schema.Struct({ kind: Schema.Literal('migration-required') })),
])

/**
 * Decode `value` with `shape` and hand the decoded payload back with its Session wire type. The shape checks the
 * fields this Host or the browser reads and keeps the rest, so the decoded value is that wire payload.
 */
const decoder = <Wire, S extends Schema.ConstraintDecoder<unknown>>(payload: SessionPayloadError['payload'], shape: S) => {
  const decode = Schema.decodeUnknownResult(shape)
  const result = (value: unknown): Result.Result<Wire, SessionPayloadError> =>
    decode(value).pipe(
      // SAFETY: the shape validated every field the Session wire type names that this Host reads, and passthrough kept the rest.
      Result.map(decoded => decoded as Wire),
      Result.mapError(cause => new SessionPayloadError({ payload, cause })),
    )
  return Object.assign((value: unknown): Effect.Effect<Wire, SessionPayloadError> => Effect.fromResult(result(value)), {
    sync: (value: unknown): Wire => Result.getOrThrowWith(result(value), error => error),
  })
}

const listDecoder = decoder<{ readonly items: readonly SessionSummary[] }, typeof sessionListSchema>('summaries', sessionListSchema)

/** Rows of one runtime's `session/list` answer. */
export const summaries = Object.assign((value: unknown) => Effect.map(listDecoder(value), list => list.items), {
  sync: (value: unknown): readonly SessionSummary[] => listDecoder.sync(value).items,
})
/** One frame of a runtime's `session/follow` stream; only its discriminant is checked, the browser validates events. */
export const followFrame = decoder<SessionFollowFrame, typeof sessionFollowFrameSchema>('follow-frame', sessionFollowFrameSchema)
/** One history page of a runtime's `session/page` answer. */
export const page = decoder<SessionPage, typeof sessionPageSchema>('page', sessionPageSchema)
/** One runtime's `session/projections` answer. */
export const projections = decoder<SessionProjectionsValue, typeof sessionProjectionsSchema>('projections', sessionProjectionsSchema)
/** An admitted prompt receipt. */
export const prompt = decoder<SessionPromptValue, typeof acceptedSchema>('prompt', acceptedSchema)
/** An admitted cancellation receipt. */
export const cancel = decoder<SessionCancelValue, typeof acceptedSchema>('cancel', acceptedSchema)
/** The model a remote Session's runtime selected. */
export const selectedModel = decoder<SessionSelectModelValue, typeof sessionSelectModelSchema>('selected-model', sessionSelectModelSchema)
/** An applied queue mutation receipt. */
export const queue = decoder<SessionUpdateQueueValue, typeof acceptedSchema>('queue', acceptedSchema)
