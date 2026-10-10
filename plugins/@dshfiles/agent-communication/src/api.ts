import { defineApi, method } from '@dshfiles/dshx/api'
import {
  communicationDeliverySchema,
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
    delivery: communicationDeliverySchema,
    allowSteerFrom: z.array(agentIdSchema).max(64),
  })
  .strict()
  .refine(input => (input.delivery === 'steer' ? input.allowSteerFrom.length > 0 : input.allowSteerFrom.length === 0), {
    message: 'Steer delivery requires an explicit sender allowlist; other delivery modes do not accept one.',
  })

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
