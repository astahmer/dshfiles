import { defineApi, method } from '@dshfiles/dshx/api'
import {
  communicationDiagnosticsSchema,
  communicationMessagePageSchema,
  communicationMessageBodySchema,
  communicationMessageRecipientsSchema,
} from '@dshfiles/dshx/communication/types'
import { Schema } from 'effect'

const agentIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const messageIdSchema = Schema.String.check(Schema.isUUID())

export const browseMessagesInputSchema = Schema.Struct({
  agentId: Schema.optional(agentIdSchema),
  search: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120))),
  beforeId: Schema.optional(messageIdSchema),
  limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100))),
})
export type AgentCommunicationBrowseInput = typeof browseMessagesInputSchema.Type

export const postMessageInputSchema = Schema.Struct({
  agentId: agentIdSchema,
  text: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(12_000)),
  intent: Schema.optional(Schema.Literals(['notice', 'request'])),
  priority: Schema.optional(Schema.Literals(['normal', 'urgent'])),
})
export type AgentCommunicationPostInput = typeof postMessageInputSchema.Type

export const postMessageReceiptSchema = Schema.Struct({
  messageId: messageIdSchema,
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
    acknowledge: method({
      input: Schema.Struct({ agentId: agentIdSchema, messageId: messageIdSchema }),
      output: Schema.Struct({ acknowledged: Schema.Boolean }),
    }),
  },
})
