import {
  CommunicationError,
  type CommunicationAgent,
  type CommunicationDiagnosticSubscription,
  type CommunicationDiagnostics,
  type CommunicationMessage,
  type CommunicationMessageBody,
  type CommunicationMessagePage,
  type CommunicationMessageRecipients,
  type CommunicationPrincipal,
  type CommunicationService,
} from '@dshfiles/dshx/communication'
import { postMessageReceiptSchema, type AgentCommunicationBrowseInput, type AgentCommunicationPostInput, type AgentCommunicationSubscriptionInput } from './api.js'

export const createAgentCommunicationOperations = (input: {
  readonly service: () => CommunicationService
  readonly listAgents: () => readonly CommunicationAgent[]
}) => {
  const requireLiveAgent = (agentId: string): void => {
    if (!input.listAgents().some(agent => agent.id === agentId)) {
      throw new CommunicationError('agent-not-live', 'Choose a currently live Agent.')
    }
  }

  return {
    diagnostics: (limit?: number): Promise<CommunicationDiagnostics> => input.service().diagnostics({ agents: input.listAgents(), limit: limit ?? 20 }),
    browseMessages: (request: AgentCommunicationBrowseInput): Promise<CommunicationMessagePage> => input.service().browseMessages(request),
    postMessage: async (request: AgentCommunicationPostInput) => {
      const sender: CommunicationPrincipal = { kind: 'external', id: 'communication-browser' }
      let message: CommunicationMessage
      if (request.topic !== undefined) {
        message = await input.service().publish({
          sender,
          topic: request.topic,
          text: request.text,
          ...(request.priority === undefined ? {} : { priority: request.priority }),
        })
      } else if (request.agentId !== undefined) {
        message = await input.service().send({
          sender,
          toAgentId: request.agentId,
          text: request.text,
          ...(request.priority === undefined ? {} : { priority: request.priority }),
        })
      } else {
        throw new CommunicationError('invalid-message-target', 'Choose a topic or direct Agent.')
      }
      return postMessageReceiptSchema.parse({
        messageId: message.id,
        topic: message.topic,
        recipientCount: message.recipients.length,
        createdAt: message.createdAt,
      })
    },
    messageRecipients: (messageId: string): Promise<CommunicationMessageRecipients> => input.service().messageRecipients(messageId),
    revealMessageBody: (messageId: string): Promise<CommunicationMessageBody> => input.service().revealMessageBody(messageId),
    setSubscription: async (request: AgentCommunicationSubscriptionInput): Promise<CommunicationDiagnosticSubscription> => {
      requireLiveAgent(request.agentId)
      const subscription = await input.service().subscribe({ kind: 'agent', id: request.agentId }, { topic: request.topic })
      return {
        principal: { kind: 'agent', id: request.agentId },
        topic: subscription.topic,
        delivery: subscription.delivery,
        createdAt: subscription.createdAt,
      }
    },
    unsubscribe: async (request: { readonly agentId: string; readonly topic: string }): Promise<{ readonly removed: boolean }> => {
      requireLiveAgent(request.agentId)
      return input.service().unsubscribe({ kind: 'agent', id: request.agentId }, request.topic)
    },
    acknowledge: (request: { readonly agentId: string; readonly messageId: string }): Promise<{ readonly acknowledged: boolean }> =>
      input.service().acknowledge({ kind: 'agent', id: request.agentId }, request.messageId),
  }
}
