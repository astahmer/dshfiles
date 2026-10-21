import type { CommunicationPrincipal, CommunicationService } from '@dshfiles/dshx/communication'
import { LiveAgentDirectoryModel } from './live-agent-directory.js'

const workspaceChannelRetentionMs = 24 * 60 * 60 * 1000

export class AgentCommunicationLifecycle {
  static readonly cleanupInactiveWorkspaceChannels = async (input: {
    readonly service: Pick<CommunicationService, 'pruneInactiveWorkspaceTopics'>
    readonly sessionCwds: readonly (string | undefined)[]
    readonly liveAgentCwds: readonly (string | undefined)[]
    readonly now: number
  }): Promise<number> => {
    const activeTopics = new Set(
      [...input.sessionCwds, ...input.liveAgentCwds].flatMap(cwd => {
        const topic = LiveAgentDirectoryModel.communicationWorkspaceTopic(cwd)
        return topic === undefined ? [] : [topic]
      }),
    )

    return input.service.pruneInactiveWorkspaceTopics({ activeTopics: [...activeTopics], inactiveBefore: input.now - workspaceChannelRetentionMs })
  }

  /**
   * Registers one Agent for peer messages. The private inbox needs no registration: a direct message names its
   * recipient, and `inbox` reads filter on the recipient, so only the workspace topic is written here.
   */
  static readonly initializeCommunicationAgent = async (input: {
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
  static readonly registerCommunicationAgent = async (input: {
    readonly service: () => CommunicationService
    readonly agentId: string
    readonly workspaceCwd: string | undefined
    readonly onFailure: (error: unknown) => void
  }): Promise<void> => {
    try {
      await AgentCommunicationLifecycle.initializeCommunicationAgent({
        service: input.service(),
        agentId: input.agentId,
        workspaceCwd: input.workspaceCwd,
      })
    } catch (error) {
      input.onFailure(error)
    }
  }
}
