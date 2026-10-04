import { z } from 'zod'

export const communicationDeliverySchema = z.enum(['quiet', 'queue', 'steer'])
export type CommunicationDelivery = z.infer<typeof communicationDeliverySchema>

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
    allowSteerFrom: z.array(z.string().min(1).max(256)).max(64),
    createdAt: z.number().int().nonnegative(),
  })
  .strict()
export type CommunicationSubscription = z.infer<typeof communicationSubscriptionSchema>

export const communicationRecipientSchema = z
  .object({
    principal: communicationPrincipalSchema,
    delivery: communicationDeliverySchema,
    allowSteerFrom: z.array(z.string().min(1).max(256)).max(64),
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
  })
  .strict()
export type CommunicationAgent = z.infer<typeof communicationAgentSchema>

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

export const communicationStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    messages: z.array(communicationMessageSchema).max(5_000),
    subscriptions: z.array(communicationSubscriptionSchema).max(5_000),
    acknowledgements: z
      .array(
        z
          .object({
            messageId: z.string().uuid(),
            principal: communicationPrincipalSchema,
            acknowledgedAt: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(100_000),
    workspaceOptOuts: z.array(z.string().min(1).max(256)).max(10_000),
    notifications: z
      .array(
        z
          .object({
            messageId: z.string().uuid(),
            agentId: z.string().min(1).max(256),
            notifiedAt: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(100_000),
  })
  .strict()
export type CommunicationState = z.infer<typeof communicationStateSchema>
