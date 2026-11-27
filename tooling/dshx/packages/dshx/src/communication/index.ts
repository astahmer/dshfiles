export { connectCommunicationClient, startHostCommunicationBridge } from './bridge.js'
export type { CommunicationClient, ConnectCommunicationClientOptions, HostCommunicationBridgeHandle } from './bridge.js'
export { CommunicationError, CommunicationService, createCommunicationService } from './service.js'
export type {
  CommunicationActivityInput,
  CommunicationBrowseInput,
  CommunicationInboxInput,
  CommunicationSendInput,
  CommunicationServiceOptions,
} from './service.js'
export {
  communicationActivityEventSchema,
  communicationActivityOperationSchema,
  communicationAgentSchema,
  communicationDeliverySchema,
  communicationDiagnosticAgentSchema,
  communicationDiagnosticMessageSchema,
  communicationDiagnosticRecipientSchema,
  communicationDiagnosticsSchema,
  communicationInboxSchema,
  communicationMessageBodySchema,
  communicationMessagePageSchema,
  communicationMessageRecipientsSchema,
  communicationMessageSchema,
  communicationPrincipalSchema,
  communicationPrioritySchema,
  communicationStateSchema,
} from './types.js'
export type {
  CommunicationActivityEvent,
  CommunicationActivityOperation,
  CommunicationAgent,
  CommunicationDelivery,
  CommunicationDiagnosticAgent,
  CommunicationDiagnosticMessage,
  CommunicationDiagnosticRecipient,
  CommunicationDiagnostics,
  CommunicationInbox,
  CommunicationMessage,
  CommunicationMessageBody,
  CommunicationMessagePage,
  CommunicationMessageRecipients,
  CommunicationPrincipal,
  CommunicationPriority,
  CommunicationRecipient,
  CommunicationState,
} from './types.js'
