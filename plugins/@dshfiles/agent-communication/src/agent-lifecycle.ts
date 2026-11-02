import { Effect } from 'effect'
import { CommunicationHub } from './communication-hub-promise.js'
import { LiveAgentDirectoryModel } from './live-agent-directory.js'

const workspaceChannelRetentionMs = 24 * 60 * 60 * 1000

/** Drops workspace topics no persisted Session or live Agent works in any more, once idle past the retention window. */
export const cleanupInactiveWorkspaceChannels = Effect.fn('agent communication cleanup workspace channels')(function* (input: {
  readonly sessionCwds: readonly (string | undefined)[]
  readonly liveAgentCwds: readonly (string | undefined)[]
  readonly now: number
}) {
  const hub = yield* CommunicationHub
  const activeTopics = new Set(
    [...input.sessionCwds, ...input.liveAgentCwds].flatMap(cwd => {
      const topic = LiveAgentDirectoryModel.communicationWorkspaceTopic(cwd)
      return topic === undefined ? [] : [topic]
    }),
  )
  return yield* hub.pruneInactiveWorkspaceTopics({ activeTopics: [...activeTopics], inactiveBefore: input.now - workspaceChannelRetentionMs })
})

/**
 * Registers one Agent for peer messages. The private inbox needs no registration: a direct message names its
 * recipient, and `inbox` reads filter on the recipient, so only the workspace topic is written here.
 */
export const initializeCommunicationAgent = Effect.fn('agent communication register agent')(function* (input: {
  readonly agentId: string
  readonly workspaceCwd: string | undefined
}) {
  const workspaceTopic = LiveAgentDirectoryModel.communicationWorkspaceTopic(input.workspaceCwd)
  if (workspaceTopic === undefined) return
  const hub = yield* CommunicationHub
  yield* hub.ensureSubscription({ kind: 'agent', id: input.agentId }, { topic: workspaceTopic, delivery: 'passive' })
})

/**
 * Best-effort registration. This runs while an Agent is being created, so a communication failure must never fail the
 * session: it is logged and the Agent starts without peer-message registration.
 */
export const registerCommunicationAgent = (input: { readonly agentId: string; readonly workspaceCwd: string | undefined }) =>
  initializeCommunicationAgent(input).pipe(
    Effect.catchCause(cause => Effect.logWarning(`agent-communication: peer-message registration failed for ${input.agentId}; the Agent still starts`, cause)),
  )
