import { defineApi, method } from '@dshfiles/dshx/api'
import {
  communicationDiagnosticSubscriptionSchema,
  communicationDiagnosticsSchema,
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

export const agentCommunicationApi = defineApi({
  id: 'agent-communication',
  version: 1,
  methods: {
    diagnostics: method({
      input: z.object({ limit: z.number().int().min(1).max(100).optional() }).strict(),
      output: communicationDiagnosticsSchema,
    }),
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
