export { connectCommunicationClient, startHostCommunicationBridge } from './bridge.js'
export type { CommunicationClient, ConnectCommunicationClientOptions, HostCommunicationBridgeHandle } from './bridge.js'
export { CommunicationError, CommunicationService, createCommunicationService } from './service.js'
export type {
  CommunicationActivityInput,
  CommunicationInboxInput,
  CommunicationPublishInput,
  CommunicationSendInput,
  CommunicationServiceOptions,
} from './service.js'
export {
  communicationActivityEventSchema,
  communicationActivityOperationSchema,
  communicationAgentSchema,
  communicationDeliverySchema,
  communicationDiagnosticMessageSchema,
  communicationDiagnosticSubscriptionSchema,
  communicationDiagnosticsSchema,
  communicationInboxSchema,
  communicationMessageSchema,
  communicationPrincipalSchema,
  communicationPrioritySchema,
  communicationSubscriptionSchema,
  communicationTopicSchema,
  communicationStateSchema,
} from './types.js'
export type {
  CommunicationActivityEvent,
  CommunicationActivityOperation,
  CommunicationAgent,
  CommunicationDelivery,
  CommunicationDiagnosticMessage,
  CommunicationDiagnosticSubscription,
  CommunicationDiagnostics,
  CommunicationInbox,
  CommunicationMessage,
  CommunicationPrincipal,
  CommunicationPriority,
  CommunicationRecipient,
  CommunicationState,
  CommunicationSubscription,
  CommunicationTopic,
} from './types.js'
