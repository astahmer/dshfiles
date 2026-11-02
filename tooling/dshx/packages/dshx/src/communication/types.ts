import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

const strictStruct = <const Fields extends Schema.Struct.Fields & { readonly [Key in keyof Fields]: Schema.ConstraintDecoder<unknown, never> }>(
  fields: Fields,
) => {
  const struct = Schema.Struct(fields).check(
    Schema.makeFilter(value =>
      Object.keys(value).every(key => Object.prototype.hasOwnProperty.call(fields, key)) ? true : 'Unexpected properties are not allowed.',
    ),
  )
  const parse = (value: unknown): typeof struct.Type => {
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).some(key => !Object.prototype.hasOwnProperty.call(fields, key))
    ) {
      throw new TypeError('Unexpected properties are not allowed.')
    }
    return Schema.decodeUnknownSync(struct)(value)
  }
  return Object.assign(struct, {
    parse,
    safeParse: (value: unknown): { readonly success: true; readonly data: typeof struct.Type } | { readonly success: false; readonly error: unknown } => {
      try {
        return { success: true, data: parse(value) }
      } catch (error) {
        return { success: false, error }
      }
    },
  })
}

const boundedString = (minimum: number, maximum: number) => Schema.String.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum))

const nonNegativeInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const boundedArray = <Item extends Schema.Constraint>(item: Item, maximum: number) => Schema.Array(item).check(Schema.isMaxLength(maximum))

const boundedInteger = (maximum: number) => nonNegativeInteger.check(Schema.isLessThanOrEqualTo(maximum))

export const communicationDeliverySchema = Schema.Literal('passive')
export type CommunicationDelivery = Schema.Schema.Type<typeof communicationDeliverySchema>

export const legacyCommunicationDeliverySchema = Schema.Literals(['quiet', 'queue', 'steer'])
export type LegacyCommunicationDelivery = Schema.Schema.Type<typeof legacyCommunicationDeliverySchema>

export const communicationPrioritySchema = Schema.Literals(['normal', 'urgent'])
export type CommunicationPriority = Schema.Schema.Type<typeof communicationPrioritySchema>

export const communicationPrincipalSchema = Schema.Union([
  strictStruct({ kind: Schema.Literal('agent'), id: boundedString(1, 256) }),
  strictStruct({
    kind: Schema.Literal('external'),
    id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80), Schema.isPattern(/^[a-zA-Z0-9._-]+$/)),
  }),
])
export type CommunicationPrincipal = Schema.Schema.Type<typeof communicationPrincipalSchema>

export const communicationSubscriptionSchema = strictStruct({
  principal: communicationPrincipalSchema,
  topic: boundedString(1, 128),
  delivery: communicationDeliverySchema,
  createdAt: nonNegativeInteger,
})

export type CommunicationSubscription = Schema.Schema.Type<typeof communicationSubscriptionSchema>

export const communicationRecipientSchema = strictStruct({
  principal: communicationPrincipalSchema,
  delivery: communicationDeliverySchema,
  readAt: Schema.NullOr(nonNegativeInteger),
})

export type CommunicationRecipient = Schema.Schema.Type<typeof communicationRecipientSchema>

export const communicationMessageIntentSchema = Schema.Literals(['notice', 'request'])
export type CommunicationMessageIntent = Schema.Schema.Type<typeof communicationMessageIntentSchema>

const communicationMessageV3Schema = strictStruct({
  id: Schema.String.check(Schema.isUUID()),
  topic: Schema.NullOr(boundedString(1, 128)),
  sender: communicationPrincipalSchema,
  text: boundedString(1, 12_000),
  priority: communicationPrioritySchema,
  createdAt: nonNegativeInteger,
  recipients: boundedArray(communicationRecipientSchema, 512),
})

export const communicationMessageSchema = strictStruct({
  id: Schema.String.check(Schema.isUUID()),
  topic: Schema.NullOr(boundedString(1, 128)),
  sender: communicationPrincipalSchema,
  text: boundedString(1, 12_000),
  intent: communicationMessageIntentSchema.pipe(Schema.withDecodingDefaultType(Effect.succeed('notice'))),
  priority: communicationPrioritySchema,
  correlationId: Schema.NullOr(boundedString(1, 128)).pipe(Schema.withDecodingDefaultType(Effect.succeed(null))),
  dedupeKey: Schema.NullOr(boundedString(1, 128)).pipe(Schema.withDecodingDefaultType(Effect.succeed(null))),
  createdAt: nonNegativeInteger,
  recipients: boundedArray(communicationRecipientSchema, 512),
})

export type CommunicationMessage = Schema.Schema.Type<typeof communicationMessageSchema>

const communicationAgentFields = {
  id: boundedString(1, 256),
  status: Schema.optional(Schema.Literals(['idle', 'running'])),
  workspaceTopic: Schema.optional(Schema.NullOr(boundedString(1, 128))),
}

export const communicationAgentSchema = strictStruct(communicationAgentFields)
export type CommunicationAgent = Schema.Schema.Type<typeof communicationAgentSchema>

export const communicationDiagnosticAgentSchema = strictStruct({
  ...communicationAgentFields,
  workspaceTopic: Schema.NullOr(boundedString(1, 128)),
  workspaceOptedOut: Schema.Boolean,
  workspaceSubscribed: Schema.optional(Schema.Boolean),
})
export type CommunicationDiagnosticAgent = Schema.Schema.Type<typeof communicationDiagnosticAgentSchema>

export const communicationTopicSchema = strictStruct({
  topic: boundedString(1, 128),
  subscribers: nonNegativeInteger,
})

export type CommunicationTopic = Schema.Schema.Type<typeof communicationTopicSchema>

export const communicationInboxSchema = strictStruct({
  items: boundedArray(communicationMessageSchema, 500),
})

export type CommunicationInbox = Schema.Schema.Type<typeof communicationInboxSchema>

export const communicationMessagePageSchema = strictStruct({
  items: boundedArray(communicationMessageSchema, 100),
  nextCursor: Schema.NullOr(Schema.String.check(Schema.isUUID())),
  totalMatching: boundedInteger(5_000),
})

export type CommunicationMessagePage = Schema.Schema.Type<typeof communicationMessagePageSchema>

const communicationAcknowledgementSchema = strictStruct({
  messageId: Schema.String.check(Schema.isUUID()),
  principal: communicationPrincipalSchema,
  acknowledgedAt: nonNegativeInteger,
})

const communicationNotificationSchema = strictStruct({
  messageId: Schema.String.check(Schema.isUUID()),
  agentId: boundedString(1, 256),
  notifiedAt: nonNegativeInteger,
})

const legacyCommunicationSubscriptionSchema = strictStruct({
  principal: communicationPrincipalSchema,
  topic: boundedString(1, 128),
  delivery: legacyCommunicationDeliverySchema,
  allowSteerFrom: boundedArray(boundedString(1, 256), 64),
  createdAt: nonNegativeInteger,
})

const legacyCommunicationRecipientSchema = strictStruct({
  principal: communicationPrincipalSchema,
  delivery: legacyCommunicationDeliverySchema,
  allowSteerFrom: boundedArray(boundedString(1, 256), 64),
})

const legacyCommunicationMessageSchema = strictStruct({
  id: Schema.String.check(Schema.isUUID()),
  topic: Schema.NullOr(boundedString(1, 128)),
  sender: communicationPrincipalSchema,
  text: boundedString(1, 12_000),
  priority: communicationPrioritySchema,
  createdAt: nonNegativeInteger,
  recipients: boundedArray(legacyCommunicationRecipientSchema, 512),
})

export const communicationActivityOperationSchema = Schema.Literals([
  'dshx_comm_agents',
  'dshx_comm_workspace',
  'dshx_comm_history',
  'dshx_comm_topics',
  'dshx_comm_subscribe',
  'dshx_comm_unsubscribe',
  'dshx_comm_publish',
  'dshx_comm_send',
  'dshx_comm_inbox',
  'dshx_comm_ack',
])
export type CommunicationActivityOperation = Schema.Schema.Type<typeof communicationActivityOperationSchema>

export const communicationActivityEventSchema = strictStruct({
  id: Schema.String.check(Schema.isUUID()),
  principal: strictStruct({ kind: Schema.Literal('agent'), id: boundedString(1, 256) }),
  operation: communicationActivityOperationSchema,
  outcome: Schema.Literals(['success', 'failure']),
  occurredAt: nonNegativeInteger,
  durationMs: boundedInteger(3_600_000),
  callId: boundedString(1, 256),
  rootCallId: Schema.NullOr(boundedString(1, 256)),
  errorCode: Schema.NullOr(boundedString(1, 80)),
})

export type CommunicationActivityEvent = Schema.Schema.Type<typeof communicationActivityEventSchema>

export const communicationStateV1Schema = strictStruct({
  schemaVersion: Schema.Literal(1),
  messages: boundedArray(legacyCommunicationMessageSchema, 5_000),
  subscriptions: boundedArray(legacyCommunicationSubscriptionSchema, 5_000),
  acknowledgements: boundedArray(communicationAcknowledgementSchema, 100_000),
  workspaceOptOuts: boundedArray(boundedString(1, 256), 10_000),
  notifications: boundedArray(communicationNotificationSchema, 100_000),
})

export type CommunicationStateV1 = Schema.Schema.Type<typeof communicationStateV1Schema>

export const communicationStateV2Schema = strictStruct({
  schemaVersion: Schema.Literal(2),
  messages: boundedArray(legacyCommunicationMessageSchema, 5_000),
  subscriptions: boundedArray(legacyCommunicationSubscriptionSchema, 5_000),
  acknowledgements: boundedArray(communicationAcknowledgementSchema, 100_000),
  workspaceOptOuts: boundedArray(boundedString(1, 256), 10_000),
  notifications: boundedArray(communicationNotificationSchema, 100_000),
  activityStartedAt: Schema.NullOr(nonNegativeInteger),
  activityEvents: boundedArray(communicationActivityEventSchema, 5_000),
})

export type CommunicationStateV2 = Schema.Schema.Type<typeof communicationStateV2Schema>

export const communicationStateV3Schema = strictStruct({
  schemaVersion: Schema.Literal(3),
  messages: boundedArray(communicationMessageV3Schema, 5_000),
  subscriptions: boundedArray(communicationSubscriptionSchema, 5_000),
  acknowledgements: boundedArray(communicationAcknowledgementSchema, 100_000),
  workspaceOptOuts: boundedArray(boundedString(1, 256), 10_000),
  activityStartedAt: Schema.NullOr(nonNegativeInteger),
  activityEvents: boundedArray(communicationActivityEventSchema, 5_000),
})

export type CommunicationStateV3 = Schema.Schema.Type<typeof communicationStateV3Schema>

export const communicationStateSchema = strictStruct({
  schemaVersion: Schema.Literal(4),
  messages: boundedArray(communicationMessageSchema, 5_000),
  subscriptions: boundedArray(communicationSubscriptionSchema, 5_000),
  acknowledgements: boundedArray(communicationAcknowledgementSchema, 100_000),
  workspaceOptOuts: boundedArray(boundedString(1, 256), 10_000),
  activityStartedAt: Schema.NullOr(nonNegativeInteger),
  activityEvents: boundedArray(communicationActivityEventSchema, 5_000),
})

export type CommunicationState = Schema.Schema.Type<typeof communicationStateSchema>

export const communicationDiagnosticRecipientSchema = strictStruct({
  principal: communicationPrincipalSchema,
  delivery: Schema.Union([communicationDeliverySchema, legacyCommunicationDeliverySchema]),
  readAt: Schema.NullOr(nonNegativeInteger).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  acknowledgedAt: Schema.NullOr(nonNegativeInteger),
  notifiedAt: Schema.optional(Schema.NullOr(nonNegativeInteger)),
  allowSteerFromCount: Schema.optional(nonNegativeInteger),
})

export type CommunicationDiagnosticRecipient = Schema.Schema.Type<typeof communicationDiagnosticRecipientSchema>

export const communicationMessageRecipientsSchema = strictStruct({
  messageId: Schema.String.check(Schema.isUUID()),
  recipientCount: boundedInteger(512),
  recipients: boundedArray(communicationDiagnosticRecipientSchema, 512),
})

export type CommunicationMessageRecipients = Schema.Schema.Type<typeof communicationMessageRecipientsSchema>

export const communicationMessageBodySchema = strictStruct({
  messageId: Schema.String.check(Schema.isUUID()),
  text: Schema.String.check(Schema.isMaxLength(12_000)),
})

export type CommunicationMessageBody = Schema.Schema.Type<typeof communicationMessageBodySchema>

export const communicationDiagnosticSubscriptionSchema = strictStruct({
  principal: communicationPrincipalSchema,
  topic: boundedString(1, 128),
  delivery: Schema.Union([communicationDeliverySchema, legacyCommunicationDeliverySchema]),
  createdAt: nonNegativeInteger,
  allowSteerFromCount: Schema.optional(nonNegativeInteger),
})

export type CommunicationDiagnosticSubscription = Schema.Schema.Type<typeof communicationDiagnosticSubscriptionSchema>

export const communicationDiagnosticMessageSchema = strictStruct({
  id: Schema.String.check(Schema.isUUID()),
  topic: Schema.NullOr(boundedString(1, 128)),
  sender: communicationPrincipalSchema,
  intent: communicationMessageIntentSchema.pipe(Schema.withDecodingDefaultType(Effect.succeed('notice'))),
  priority: communicationPrioritySchema,
  createdAt: nonNegativeInteger,
  recipientCount: boundedInteger(512),
  pendingRecipientCount: boundedInteger(512),
  unnotifiedRecipientCount: Schema.optional(boundedInteger(512)),
})

export type CommunicationDiagnosticMessage = Schema.Schema.Type<typeof communicationDiagnosticMessageSchema>

export const communicationDiagnosticsSchema = strictStruct({
  generatedAt: nonNegativeInteger,
  agentCount: nonNegativeInteger,
  agents: boundedArray(communicationDiagnosticAgentSchema, 100),
  topicCount: nonNegativeInteger,
  topics: boundedArray(communicationTopicSchema, 100),
  subscriptionCount: nonNegativeInteger,
  subscriptions: boundedArray(communicationDiagnosticSubscriptionSchema, 100),
  messageCount: nonNegativeInteger,
  pendingMessageCount: nonNegativeInteger,
  pendingRecipientCount: nonNegativeInteger,
  unnotifiedRecipientCount: Schema.optional(nonNegativeInteger),
  recentMessages: boundedArray(communicationDiagnosticMessageSchema, 100),
  activity: strictStruct({
    trackingStartedAt: Schema.NullOr(nonNegativeInteger),
    oldestRetainedAt: Schema.NullOr(nonNegativeInteger),
    retainedCount: nonNegativeInteger,
    events: boundedArray(communicationActivityEventSchema, 100),
  }),
  historyNote: Schema.String.check(Schema.isMaxLength(256)),
})

export type CommunicationDiagnostics = Schema.Schema.Type<typeof communicationDiagnosticsSchema>
