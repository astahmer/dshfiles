import { Effect } from 'effect'
import { CommunicationHub } from './communication-hub-promise.js'
import { LiveAgentDirectoryModel } from './live-agent-directory.js'

const workspaceChannelRetentionMs = 24 * 60 * 60 * 1000

/**
 * Drops generated workspace topics no live Agent works in once idle past the retention window. Peers talk through the
 * direct inbox; a workspace topic is an explicit opt-in now, so a plain subscription no longer keeps it alive on its
 * own (older versions subscribed every Agent at creation and left thousands of unread channels behind).
 */
export const cleanupInactiveWorkspaceChannels = Effect.fn('agent communication cleanup workspace channels')(function* (input: {
  readonly liveAgentCwds: readonly (string | undefined)[]
  readonly now: number
}) {
  const hub = yield* CommunicationHub
  const activeTopics = new Set(
    input.liveAgentCwds.flatMap(cwd => {
      const topic = LiveAgentDirectoryModel.communicationWorkspaceTopic(cwd)
      return topic === undefined ? [] : [topic]
    }),
  )
  return yield* hub.pruneInactiveWorkspaceTopics({ activeTopics: [...activeTopics], inactiveBefore: input.now - workspaceChannelRetentionMs })
})
