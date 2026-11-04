import { defineApi, method } from '@dshfiles/dshx/api'
import {
  communicationDiagnosticSubscriptionSchema,
  communicationDiagnosticsSchema,
  communicationMessagePageSchema,
  communicationMessageBodySchema,
  communicationMessageRecipientsSchema,
} from '@dshfiles/dshx/communication/types'
import { Schema } from 'effect'

const agentIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const messageIdSchema = Schema.String.check(Schema.isUUID())
const topicSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))

const subscriptionInputSchema = Schema.Struct({
  agentId: agentIdSchema,
  topic: topicSchema,
})

export type AgentCommunicationSubscriptionInput = typeof subscriptionInputSchema.Type

export const browseMessagesInputSchema = Schema.Struct({
  topic: Schema.optional(topicSchema),
  agentId: Schema.optional(agentIdSchema),
  search: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120))),
  beforeId: Schema.optional(messageIdSchema),
  limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100))),
}).check(Schema.makeFilter(input => (input.topic === undefined || input.agentId === undefined ? true : 'Choose a topic or direct Agent, not both.')))
export type AgentCommunicationBrowseInput = typeof browseMessagesInputSchema.Type

export const postMessageInputSchema = Schema.Struct({
  topic: Schema.optional(topicSchema),
  agentId: Schema.optional(agentIdSchema),
  text: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(12_000)),
  intent: Schema.optional(Schema.Literals(['notice', 'request'])),
  priority: Schema.optional(Schema.Literals(['normal', 'urgent'])),
}).check(Schema.makeFilter(input => ((input.topic === undefined) !== (input.agentId === undefined) ? true : 'Choose exactly one topic or direct Agent.')))
export type AgentCommunicationPostInput = typeof postMessageInputSchema.Type

export const postMessageReceiptSchema = Schema.Struct({
  messageId: messageIdSchema,
  topic: Schema.NullOr(topicSchema),
  intent: Schema.Literals(['notice', 'request']),
  recipientCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(512)),
  createdAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})

export const agentCommunicationApi = defineApi({
  id: 'agent-communication',
  version: 1,
  methods: {
    diagnostics: method({
      input: Schema.Struct({ limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100))) }),
      output: communicationDiagnosticsSchema,
    }),
    browseMessages: method({
      input: browseMessagesInputSchema,
      output: communicationMessagePageSchema,
    }),
    postMessage: method({ input: postMessageInputSchema, output: postMessageReceiptSchema }),
    messageRecipients: method({
      input: Schema.Struct({ messageId: messageIdSchema }),
      output: communicationMessageRecipientsSchema,
    }),
    revealMessageBody: method({
      input: Schema.Struct({ messageId: messageIdSchema }),
      output: communicationMessageBodySchema,
    }),
    setSubscription: method({ input: subscriptionInputSchema, output: communicationDiagnosticSubscriptionSchema }),
    unsubscribe: method({
      input: Schema.Struct({ agentId: agentIdSchema, topic: topicSchema }),
      output: Schema.Struct({ removed: Schema.Boolean }),
    }),
    acknowledge: method({
      input: Schema.Struct({ agentId: agentIdSchema, messageId: messageIdSchema }),
      output: Schema.Struct({ acknowledged: Schema.Boolean }),
    }),
  },
})
