import type { CommunicationPrincipal, CommunicationService } from '@dshfiles/dshx/communication'
import { LiveAgentDirectoryModel } from './live-agent-directory.js'

/**
 * Registers one Agent for peer messages. The private inbox needs no registration: a direct message names its
 * recipient, and `inbox` reads filter on the recipient, so only the workspace topic is written here.
 */
export const initializeCommunicationAgent = async (input: {
  readonly service: CommunicationService
  readonly agentId: string
  readonly workspaceCwd: string | undefined
}): Promise<void> => {
  const principal: CommunicationPrincipal = { kind: 'agent', id: input.agentId }
  const workspaceTopic = LiveAgentDirectoryModel.communicationWorkspaceTopic(input.workspaceCwd)
  if (workspaceTopic !== undefined) await input.service.ensureSubscription(principal, { topic: workspaceTopic, delivery: 'passive' })
}

/**
 * Best-effort registration. This runs while an Agent is being created, so a communication failure must never fail the
 * session: the caller reports it and the Agent starts without peer-message registration.
 */
export const registerCommunicationAgent = async (input: {
  readonly service: () => CommunicationService
  readonly agentId: string
  readonly workspaceCwd: string | undefined
  readonly onFailure: (error: unknown) => void
}): Promise<void> => {
  try {
    await initializeCommunicationAgent({ service: input.service(), agentId: input.agentId, workspaceCwd: input.workspaceCwd })
  } catch (error) {
    input.onFailure(error)
  }
}
