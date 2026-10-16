import type { CommunicationPrincipal, CommunicationService } from '@dshfiles/dshx/communication'
import { LiveAgentDirectoryModel } from './live-agent-directory.js'

export const initializeCommunicationAgent = async (input: {
  readonly service: CommunicationService
  readonly agentId: string
  readonly workspaceCwd: string | undefined
}): Promise<void> => {
  const principal: CommunicationPrincipal = { kind: 'agent', id: input.agentId }
  const workspaceTopic = LiveAgentDirectoryModel.communicationWorkspaceTopic(input.workspaceCwd)
  if (workspaceTopic !== undefined) await input.service.ensureSubscription(principal, { topic: workspaceTopic, delivery: 'passive' })
  await input.service.ensureSubscription(principal, { topic: 'inbox', delivery: 'passive' })
}
