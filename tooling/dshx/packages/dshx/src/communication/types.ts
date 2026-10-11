import { z } from 'zod'

export const communicationDeliverySchema = z.literal('passive')
export type CommunicationDelivery = z.infer<typeof communicationDeliverySchema>

export const legacyCommunicationDeliverySchema = z.enum(['quiet', 'queue', 'steer'])
export type LegacyCommunicationDelivery = z.infer<typeof legacyCommunicationDeliverySchema>

export const communicationPrioritySchema = z.enum(['normal', 'urgent'])
export type CommunicationPriority = z.infer<typeof communicationPrioritySchema>

export const communicationPrincipalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent'), id: z.string().min(1).max(256) }).strict(),
  z
    .object({
      kind: z.literal('external'),
      id: z
        .string()
        .min(1)
        .max(80)
        .regex(/^[a-zA-Z0-9._-]+$/),
    })
    .strict(),
])
export type CommunicationPrincipal = z.infer<typeof communicationPrincipalSchema>

export const communicationSubscriptionSchema = z
  .object({
    principal: communicationPrincipalSchema,
    topic: z.string().min(1).max(128),
    delivery: communicationDeliverySchema,
    createdAt: z.number().int().nonnegative(),
  })
  .strict()
export type CommunicationSubscription = z.infer<typeof communicationSubscriptionSchema>

export const communicationRecipientSchema = z
  .object({
    principal: communicationPrincipalSchema,
    delivery: communicationDeliverySchema,
    readAt: z.number().int().nonnegative().nullable(),
  })
  .strict()
export type CommunicationRecipient = z.infer<typeof communicationRecipientSchema>

export const communicationMessageSchema = z
  .object({
    id: z.string().uuid(),
    topic: z.string().min(1).max(128).nullable(),
    sender: communicationPrincipalSchema,
    text: z.string().min(1).max(12_000),
    priority: communicationPrioritySchema,
    createdAt: z.number().int().nonnegative(),
    recipients: z.array(communicationRecipientSchema).max(512),
  })
  .strict()
export type CommunicationMessage = z.infer<typeof communicationMessageSchema>

export const communicationAgentSchema = z
  .object({
    id: z.string().min(1).max(256),
    status: z.enum(['idle', 'running']).optional(),
    workspaceTopic: z.string().min(1).max(128).nullable().optional(),
  })
  .strict()
export type CommunicationAgent = z.infer<typeof communicationAgentSchema>

export const communicationDiagnosticAgentSchema = communicationAgentSchema
  .extend({
    workspaceTopic: z.string().min(1).max(128).nullable(),
    workspaceOptedOut: z.boolean(),
    workspaceSubscribed: z.boolean().optional(),
  })
  .strict()
export type CommunicationDiagnosticAgent = z.infer<typeof communicationDiagnosticAgentSchema>

export const communicationTopicSchema = z
  .object({
    topic: z.string().min(1).max(128),
    subscribers: z.number().int().nonnegative(),
  })
  .strict()
export type CommunicationTopic = z.infer<typeof communicationTopicSchema>

export const communicationInboxSchema = z
  .object({
    items: z.array(communicationMessageSchema).max(500),
  })
  .strict()
export type CommunicationInbox = z.infer<typeof communicationInboxSchema>

export const communicationMessagePageSchema = z
  .object({
    items: z.array(communicationMessageSchema).max(100),
    nextCursor: z.string().uuid().nullable(),
    totalMatching: z.number().int().nonnegative().max(5_000),
  })
  .strict()
export type CommunicationMessagePage = z.infer<typeof communicationMessagePageSchema>

const communicationAcknowledgementSchema = z
  .object({
    messageId: z.string().uuid(),
    principal: communicationPrincipalSchema,
    acknowledgedAt: z.number().int().nonnegative(),
  })
  .strict()

const communicationNotificationSchema = z
  .object({
    messageId: z.string().uuid(),
    agentId: z.string().min(1).max(256),
    notifiedAt: z.number().int().nonnegative(),
  })
  .strict()

const legacyCommunicationSubscriptionSchema = z
  .object({
    principal: communicationPrincipalSchema,
    topic: z.string().min(1).max(128),
    delivery: legacyCommunicationDeliverySchema,
    allowSteerFrom: z.array(z.string().min(1).max(256)).max(64),
    createdAt: z.number().int().nonnegative(),
  })
  .strict()

const legacyCommunicationRecipientSchema = z
  .object({
    principal: communicationPrincipalSchema,
    delivery: legacyCommunicationDeliverySchema,
    allowSteerFrom: z.array(z.string().min(1).max(256)).max(64),
  })
  .strict()

const legacyCommunicationMessageSchema = z
  .object({
    id: z.string().uuid(),
    topic: z.string().min(1).max(128).nullable(),
    sender: communicationPrincipalSchema,
    text: z.string().min(1).max(12_000),
    priority: communicationPrioritySchema,
    createdAt: z.number().int().nonnegative(),
    recipients: z.array(legacyCommunicationRecipientSchema).max(512),
  })
  .strict()

export const communicationActivityOperationSchema = z.enum([
  'dshx_comm_agents',
  'dshx_comm_topics',
  'dshx_comm_subscribe',
  'dshx_comm_unsubscribe',
  'dshx_comm_publish',
  'dshx_comm_send',
  'dshx_comm_inbox',
  'dshx_comm_ack',
])
export type CommunicationActivityOperation = z.infer<typeof communicationActivityOperationSchema>

export const communicationActivityEventSchema = z
  .object({
    id: z.string().uuid(),
    principal: z.object({ kind: z.literal('agent'), id: z.string().min(1).max(256) }).strict(),
    operation: communicationActivityOperationSchema,
    outcome: z.enum(['success', 'failure']),
    occurredAt: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative().max(3_600_000),
    callId: z.string().min(1).max(256),
    rootCallId: z.string().min(1).max(256).nullable(),
    errorCode: z.string().min(1).max(80).nullable(),
  })
  .strict()
export type CommunicationActivityEvent = z.infer<typeof communicationActivityEventSchema>

export const communicationStateV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    messages: z.array(legacyCommunicationMessageSchema).max(5_000),
    subscriptions: z.array(legacyCommunicationSubscriptionSchema).max(5_000),
    acknowledgements: z.array(communicationAcknowledgementSchema).max(100_000),
    workspaceOptOuts: z.array(z.string().min(1).max(256)).max(10_000),
    notifications: z.array(communicationNotificationSchema).max(100_000),
  })
  .strict()
export type CommunicationStateV1 = z.infer<typeof communicationStateV1Schema>

export const communicationStateV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    messages: z.array(legacyCommunicationMessageSchema).max(5_000),
    subscriptions: z.array(legacyCommunicationSubscriptionSchema).max(5_000),
    acknowledgements: z.array(communicationAcknowledgementSchema).max(100_000),
    workspaceOptOuts: z.array(z.string().min(1).max(256)).max(10_000),
    notifications: z.array(communicationNotificationSchema).max(100_000),
    activityStartedAt: z.number().int().nonnegative().nullable(),
    activityEvents: z.array(communicationActivityEventSchema).max(5_000),
  })
  .strict()
export type CommunicationStateV2 = z.infer<typeof communicationStateV2Schema>

export const communicationStateSchema = z
  .object({
    schemaVersion: z.literal(3),
    messages: z.array(communicationMessageSchema).max(5_000),
    subscriptions: z.array(communicationSubscriptionSchema).max(5_000),
    acknowledgements: z.array(communicationAcknowledgementSchema).max(100_000),
    workspaceOptOuts: z.array(z.string().min(1).max(256)).max(10_000),
    activityStartedAt: z.number().int().nonnegative().nullable(),
    activityEvents: z.array(communicationActivityEventSchema).max(5_000),
  })
  .strict()
export type CommunicationState = z.infer<typeof communicationStateSchema>

export const communicationDiagnosticRecipientSchema = z
  .object({
    principal: communicationPrincipalSchema,
    delivery: z.union([communicationDeliverySchema, legacyCommunicationDeliverySchema]),
    readAt: z.number().int().nonnegative().nullable().optional().default(null),
    acknowledgedAt: z.number().int().nonnegative().nullable(),
    notifiedAt: z.number().int().nonnegative().nullable().optional(),
    allowSteerFromCount: z.number().int().nonnegative().optional(),
  })
  .strict()
export type CommunicationDiagnosticRecipient = z.infer<typeof communicationDiagnosticRecipientSchema>

export const communicationMessageRecipientsSchema = z
  .object({
    messageId: z.string().uuid(),
    recipientCount: z.number().int().nonnegative().max(512),
    recipients: z.array(communicationDiagnosticRecipientSchema).max(512),
  })
  .strict()
export type CommunicationMessageRecipients = z.infer<typeof communicationMessageRecipientsSchema>

export const communicationMessageBodySchema = z
  .object({
    messageId: z.string().uuid(),
    text: z.string().max(12_000),
  })
  .strict()
export type CommunicationMessageBody = z.infer<typeof communicationMessageBodySchema>

export const communicationDiagnosticSubscriptionSchema = z
  .object({
    principal: communicationPrincipalSchema,
    topic: z.string().min(1).max(128),
    delivery: z.union([communicationDeliverySchema, legacyCommunicationDeliverySchema]),
    createdAt: z.number().int().nonnegative(),
    allowSteerFromCount: z.number().int().nonnegative().optional(),
  })
  .strict()
export type CommunicationDiagnosticSubscription = z.infer<typeof communicationDiagnosticSubscriptionSchema>

export const communicationDiagnosticMessageSchema = z
  .object({
    id: z.string().uuid(),
    topic: z.string().min(1).max(128).nullable(),
    sender: communicationPrincipalSchema,
    priority: communicationPrioritySchema,
    createdAt: z.number().int().nonnegative(),
    recipientCount: z.number().int().nonnegative().max(512),
    pendingRecipientCount: z.number().int().nonnegative().max(512),
    unnotifiedRecipientCount: z.number().int().nonnegative().max(512).optional(),
  })
  .strict()
export type CommunicationDiagnosticMessage = z.infer<typeof communicationDiagnosticMessageSchema>

export const communicationDiagnosticsSchema = z
  .object({
    generatedAt: z.number().int().nonnegative(),
    agentCount: z.number().int().nonnegative(),
    agents: z.array(communicationDiagnosticAgentSchema).max(100),
    topicCount: z.number().int().nonnegative(),
    topics: z.array(communicationTopicSchema).max(100),
    subscriptionCount: z.number().int().nonnegative(),
    subscriptions: z.array(communicationDiagnosticSubscriptionSchema).max(100),
    messageCount: z.number().int().nonnegative(),
    pendingMessageCount: z.number().int().nonnegative(),
    pendingRecipientCount: z.number().int().nonnegative(),
    unnotifiedRecipientCount: z.number().int().nonnegative().optional(),
    recentMessages: z.array(communicationDiagnosticMessageSchema).max(100),
    activity: z
      .object({
        trackingStartedAt: z.number().int().nonnegative().nullable(),
        oldestRetainedAt: z.number().int().nonnegative().nullable(),
        retainedCount: z.number().int().nonnegative(),
        events: z.array(communicationActivityEventSchema).max(100),
      })
      .strict(),
    historyNote: z.string().max(256),
  })
  .strict()
export type CommunicationDiagnostics = z.infer<typeof communicationDiagnosticsSchema>
