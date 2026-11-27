import type { CommunicationMessage, CommunicationPrincipal } from '@dshfiles/dshx/communication'
import { Context, Effect, Layer } from 'effect'
import type { AgentCommunicationBrowseInput, AgentCommunicationPostInput } from './api.js'
import { CommunicationHub, type CommunicationHubShape, CommunicationOperationFailed } from './communication-hub-promise.js'
import { HostAgents } from './host-edge-promise.js'

const browserSender: CommunicationPrincipal = { kind: 'external', id: 'communication-browser' }

type Hub = CommunicationHubShape

export interface CommunicationOperationsShape {
  readonly diagnostics: (limit: number | undefined) => ReturnType<Hub['diagnostics']>
  readonly browseMessages: (request: AgentCommunicationBrowseInput) => ReturnType<Hub['browseMessages']>
  readonly postMessage: (request: AgentCommunicationPostInput) => Effect.Effect<
    {
      readonly messageId: string
      readonly intent: CommunicationMessage['intent']
      readonly recipientCount: number
      readonly createdAt: number
    },
    CommunicationOperationFailed
  >
  readonly messageRecipients: (messageId: string) => ReturnType<Hub['messageRecipients']>
  readonly revealMessageBody: (messageId: string) => ReturnType<Hub['revealMessageBody']>
  readonly acknowledge: (request: { readonly agentId: string; readonly messageId: string }) => ReturnType<Hub['acknowledge']>
}

/** The Messages panel's direct reads and writes; the browser posts as its own external principal. */
export class CommunicationOperations extends Context.Service<CommunicationOperations, CommunicationOperationsShape>()(
  '@dshfiles/agent-communication/CommunicationOperations',
) {
  static readonly layer = Layer.effect(
    CommunicationOperations,
    Effect.gen(function* () {
      const hub = yield* CommunicationHub
      const agents = yield* HostAgents

      return CommunicationOperations.of({
        diagnostics: limit => Effect.flatMap(agents.communicationAgents, live => hub.diagnostics({ agents: live, limit: limit ?? 20 })),
        browseMessages: request => hub.browseMessages(request),
        postMessage: Effect.fn('agent communication post message')(function* (request) {
          const intent = request.intent === undefined ? {} : { intent: request.intent }
          const priority = request.priority === undefined ? {} : { priority: request.priority }
          const message: CommunicationMessage = yield* hub.send({
            sender: browserSender,
            toAgentId: request.agentId,
            text: request.text,
            ...intent,
            ...priority,
          })
          return {
            messageId: message.id,
            intent: message.intent,
            recipientCount: message.recipients.length,
            createdAt: message.createdAt,
          }
        }),
        messageRecipients: messageId => hub.messageRecipients(messageId),
        revealMessageBody: messageId => hub.revealMessageBody(messageId),
        acknowledge: request => hub.acknowledge({ kind: 'agent', id: request.agentId }, request.messageId),
      })
    }),
  )
}
