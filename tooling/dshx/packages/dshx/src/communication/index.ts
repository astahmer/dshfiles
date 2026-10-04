export { connectCommunicationClient, startHostCommunicationBridge } from './bridge.js'
export type { CommunicationClient, ConnectCommunicationClientOptions, HostCommunicationBridgeHandle } from './bridge.js'
export { CommunicationError, CommunicationService, createCommunicationService } from './service.js'
export type { CommunicationInboxInput, CommunicationPublishInput, CommunicationSendInput, CommunicationServiceOptions } from './service.js'
export {
  communicationAgentSchema,
  communicationDeliverySchema,
  communicationInboxSchema,
  communicationMessageSchema,
  communicationPrincipalSchema,
  communicationPrioritySchema,
  communicationSubscriptionSchema,
  communicationTopicSchema,
  communicationStateSchema,
} from './types.js'
export type {
  CommunicationAgent,
  CommunicationDelivery,
  CommunicationInbox,
  CommunicationMessage,
  CommunicationPrincipal,
  CommunicationPriority,
  CommunicationRecipient,
  CommunicationState,
  CommunicationSubscription,
  CommunicationTopic,
} from './types.js'
