import type { CommunicationMessage, CommunicationPrincipal } from '@dshfiles/dshx/communication'
import { Context, Effect, Layer } from 'effect'
import type { AgentCommunicationBrowseInput, AgentCommunicationPostInput, AgentCommunicationSubscriptionInput } from './api.js'
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
      readonly topic: string | null
      readonly intent: CommunicationMessage['intent']
      readonly recipientCount: number
      readonly createdAt: number
    },
    CommunicationOperationFailed
  >
  readonly messageRecipients: (messageId: string) => ReturnType<Hub['messageRecipients']>
  readonly revealMessageBody: (messageId: string) => ReturnType<Hub['revealMessageBody']>
  readonly setSubscription: (request: AgentCommunicationSubscriptionInput) => Effect.Effect<
    {
      readonly principal: CommunicationPrincipal
      readonly topic: string
      readonly delivery: 'passive'
      readonly createdAt: number
    },
    CommunicationOperationFailed
  >
  readonly unsubscribe: (request: { readonly agentId: string; readonly topic: string }) => ReturnType<Hub['unsubscribe']>
  readonly acknowledge: (request: { readonly agentId: string; readonly messageId: string }) => ReturnType<Hub['acknowledge']>
}

/** The Communication panel's reads and writes; the browser posts as its own external principal. */
export class CommunicationOperations extends Context.Service<CommunicationOperations, CommunicationOperationsShape>()(
  '@dshfiles/agent-communication/CommunicationOperations',
) {
  static readonly layer = Layer.effect(
    CommunicationOperations,
    Effect.gen(function* () {
      const hub = yield* CommunicationHub
      const agents = yield* HostAgents

      const requireLiveAgent = Effect.fnUntraced(function* (agentId: string) {
        if (!(yield* agents.communicationAgents).some(agent => agent.id === agentId))
          return yield* new CommunicationOperationFailed({ operation: 'subscription', code: 'agent-not-live', detail: 'Choose a currently live Agent.' })
      })

      return CommunicationOperations.of({
        diagnostics: limit => Effect.flatMap(agents.communicationAgents, live => hub.diagnostics({ agents: live, limit: limit ?? 20 })),
        browseMessages: request => hub.browseMessages(request),
        postMessage: Effect.fn('agent communication post message')(function* (request) {
          const intent = request.intent === undefined ? {} : { intent: request.intent }
          const priority = request.priority === undefined ? {} : { priority: request.priority }
          let message: CommunicationMessage
          if (request.topic !== undefined)
            message = yield* hub.publish({ sender: browserSender, topic: request.topic, text: request.text, ...intent, ...priority })
          else if (request.agentId !== undefined)
            message = yield* hub.send({ sender: browserSender, toAgentId: request.agentId, text: request.text, ...intent, ...priority })
          else
            return yield* new CommunicationOperationFailed({
              operation: 'post message',
              code: 'invalid-message-target',
              detail: 'Choose a topic or direct Agent.',
            })
          return {
            messageId: message.id,
            topic: message.topic,
            intent: message.intent,
            recipientCount: message.recipients.length,
            createdAt: message.createdAt,
          }
        }),
        messageRecipients: messageId => hub.messageRecipients(messageId),
        revealMessageBody: messageId => hub.revealMessageBody(messageId),
        setSubscription: Effect.fn('agent communication set subscription')(function* (request) {
          yield* requireLiveAgent(request.agentId)
          const principal: CommunicationPrincipal = { kind: 'agent', id: request.agentId }
          const subscription = yield* hub.subscribe(principal, { topic: request.topic })
          return { principal, topic: subscription.topic, delivery: subscription.delivery, createdAt: subscription.createdAt }
        }),
        unsubscribe: request => Effect.andThen(requireLiveAgent(request.agentId), hub.unsubscribe({ kind: 'agent', id: request.agentId }, request.topic)),
        acknowledge: request => hub.acknowledge({ kind: 'agent', id: request.agentId }, request.messageId),
      })
    }),
  )
}
