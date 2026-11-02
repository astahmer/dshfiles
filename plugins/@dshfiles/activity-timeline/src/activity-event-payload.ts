import { Schema } from 'effect'
import {
  backlogActivity,
  communicationActivity,
  communicationMessage,
  integrationActivity,
  verificationReceiptActivity,
  workspaceActivity,
} from './adapters.js'
import { activityLevelSchema, backlogActivitySchema, verificationReceiptEventSchema, type ActivityIngest } from './types.js'

const timestamp = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const boundedText = (max: number) => Schema.String.check(Schema.isMaxLength(max))
const requiredText = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))

const communicationActivityEvent = Schema.Struct({
  kind: Schema.Literal('communication-activity'),
  value: Schema.Struct({
    at: timestamp,
    sessionId: Schema.NullOr(boundedText(256)),
    operation: requiredText(80),
    outcome: Schema.Literals(['success', 'failure']),
    callId: requiredText(256),
    rootCallId: Schema.NullOr(boundedText(256)),
    correlationId: Schema.optional(boundedText(128)),
    errorCode: Schema.optional(Schema.NullOr(boundedText(120))),
  }),
})

const communicationMessageEvent = Schema.Struct({
  kind: Schema.Literal('communication-message'),
  value: Schema.Struct({
    at: timestamp,
    messageId: requiredText(256),
    senderId: requiredText(256),
    recipientCount: timestamp,
    intent: Schema.Literals(['notice', 'request']),
    topic: Schema.NullOr(boundedText(128)),
    correlationId: Schema.optional(boundedText(128)),
    sessionId: Schema.optional(Schema.NullOr(boundedText(256))),
  }),
})

const integrationEvent = Schema.Struct({
  kind: Schema.Literal('integration'),
  value: Schema.Struct({
    id: requiredText(256),
    at: timestamp,
    type: requiredText(80),
    workspaceId: Schema.NullOr(boundedText(256)),
    sessionId: Schema.NullOr(boundedText(256)),
    candidateId: Schema.NullOr(boundedText(256)),
    correlationId: Schema.NullOr(boundedText(128)),
    detail: Schema.NullOr(boundedText(2000)),
    outcome: Schema.NullOr(boundedText(80)),
  }),
})

const workspaceEvent = Schema.Struct({
  kind: Schema.Literal('workspace'),
  value: Schema.Struct({
    id: requiredText(256),
    at: timestamp,
    type: requiredText(80),
    level: activityLevelSchema,
    summary: requiredText(500),
    detail: Schema.NullOr(boundedText(2000)),
    sessionId: Schema.NullOr(boundedText(256)),
    correlationId: Schema.NullOr(boundedText(128)),
    workspaceId: Schema.NullOr(boundedText(256)),
    workspaceName: Schema.NullOr(boundedText(200)),
  }),
})

const backlogEvent = Schema.Struct({ kind: Schema.Literal('backlog'), value: backlogActivitySchema })

/** Every payload other plugins emit on `dshfiles/activity/event`, decoded by `kind`. */
export const activityEventPayloadSchema = Schema.Union([
  communicationActivityEvent,
  communicationMessageEvent,
  integrationEvent,
  workspaceEvent,
  backlogEvent,
  verificationReceiptEventSchema,
])
export type ActivityEventPayload = typeof activityEventPayloadSchema.Type

/** The one activity item a decoded payload becomes. */
export const ingestOfPayload = (payload: ActivityEventPayload): ActivityIngest => {
  if (payload.kind === 'communication-activity') return communicationActivity(payload.value)
  if (payload.kind === 'communication-message') return communicationMessage(payload.value)
  if (payload.kind === 'integration') return integrationActivity(payload.value)
  if (payload.kind === 'workspace') return workspaceActivity(payload.value)
  if (payload.kind === 'backlog') return backlogActivity(payload.value)
  return verificationReceiptActivity(payload.value)
}
