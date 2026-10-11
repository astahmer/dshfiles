import { defineApi, method } from '@dshfiles/dshx/api'
import {
  communicationDiagnosticSubscriptionSchema,
  communicationDiagnosticsSchema,
  communicationMessagePageSchema,
  communicationMessageBodySchema,
  communicationMessageRecipientsSchema,
} from '@dshfiles/dshx/communication/types'
import { z } from 'zod'

const agentIdSchema = z.string().min(1).max(256)
const messageIdSchema = z.string().uuid()
const topicSchema = z.string().min(1).max(128)

export const subscriptionInputSchema = z
  .object({
    agentId: agentIdSchema,
    topic: topicSchema,
  })
  .strict()

export type AgentCommunicationSubscriptionInput = z.infer<typeof subscriptionInputSchema>

export const browseMessagesInputSchema = z
  .object({
    topic: topicSchema.optional(),
    agentId: agentIdSchema.optional(),
    search: z.string().trim().min(1).max(120).optional(),
    beforeId: messageIdSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .refine(input => input.topic === undefined || input.agentId === undefined, 'Choose a topic or direct Agent, not both.')
export type AgentCommunicationBrowseInput = z.infer<typeof browseMessagesInputSchema>

export const postMessageInputSchema = z
  .object({
    topic: topicSchema.optional(),
    agentId: agentIdSchema.optional(),
    text: z.string().trim().min(1).max(12_000),
    priority: z.enum(['normal', 'urgent']).optional(),
  })
  .strict()
  .refine(input => (input.topic === undefined) !== (input.agentId === undefined), 'Choose exactly one topic or direct Agent.')
export type AgentCommunicationPostInput = z.infer<typeof postMessageInputSchema>

export const postMessageReceiptSchema = z
  .object({
    messageId: messageIdSchema,
    topic: topicSchema.nullable(),
    recipientCount: z.number().int().nonnegative().max(512),
    createdAt: z.number().int().nonnegative(),
  })
  .strict()

export const agentCommunicationApi = defineApi({
  id: 'agent-communication',
  version: 1,
  methods: {
    diagnostics: method({
      input: z.object({ limit: z.number().int().min(1).max(100).optional() }).strict(),
      output: communicationDiagnosticsSchema,
    }),
    browseMessages: method({ input: browseMessagesInputSchema, output: communicationMessagePageSchema }),
    postMessage: method({ input: postMessageInputSchema, output: postMessageReceiptSchema }),
    messageRecipients: method({
      input: z.object({ messageId: messageIdSchema }).strict(),
      output: communicationMessageRecipientsSchema,
    }),
    revealMessageBody: method({
      input: z.object({ messageId: messageIdSchema }).strict(),
      output: communicationMessageBodySchema,
    }),
    setSubscription: method({ input: subscriptionInputSchema, output: communicationDiagnosticSubscriptionSchema }),
    unsubscribe: method({
      input: z.object({ agentId: agentIdSchema, topic: topicSchema }).strict(),
      output: z.object({ removed: z.boolean() }).strict(),
    }),
    acknowledge: method({
      input: z.object({ agentId: agentIdSchema, messageId: messageIdSchema }).strict(),
      output: z.object({ acknowledged: z.boolean() }).strict(),
    }),
  },
})
