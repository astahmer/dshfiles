import type {} from '@deepseek-ai/dsh-agent'
import { Api, DshxPlugin, HostEvents } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Clock, Duration, Effect, Layer } from 'effect'
import { cleanupInactiveWorkspaceChannels } from './agent-lifecycle.js'
import { agentCommunicationApi } from './api.js'
import { CommunicationOperations } from './api-operations.js'
import { CommunicationHub } from './communication-hub-promise.js'
import { communicationTools } from './communication-tools.js'
import { HostAgents, SessionCorpus, ThreadAgents } from './host-edge-promise.js'
import { MailWake } from './mail-wake.js'
import { RecipientDirectory } from './recipient-directory.js'
import { recurringTask } from './recurring-task.js'
import { agentCommunicationSettings, CommSettingsLive } from './settings.js'
import { UnreadCounts, UnreadPrompt } from './unread-counts.js'
import { UnreadNudgeRules } from './unread-nudge.js'

const workspaceTopicCleanupInterval = Duration.hours(1)

/** One pass over the generated workspace topics: no live Agent there and idle past the window means it goes. */
const pruneWorkspaceTopics = Effect.gen(function* () {
  const agents = yield* HostAgents
  const now = yield* Clock.currentTimeMillis
  return yield* cleanupInactiveWorkspaceChannels({ liveAgentCwds: (yield* agents.list).map(agent => agent.session.header.cwd), now })
})

/** Every message the timeline asks to backfill is re-announced once on the activity event. */
const ActivityBackfill = Layer.effectDiscard(
  HostEvents.on('dshfiles/activity/backfill', () =>
    Effect.gen(function* () {
      const hub = yield* CommunicationHub
      const agents = yield* HostAgents
      const page = yield* hub.browseMessages({ limit: 100 })
      yield* Effect.forEach(
        page.items,
        message =>
          agents.emitActivity({
            kind: 'communication-message',
            value: {
              at: message.createdAt,
              messageId: message.id,
              senderId: message.sender.id,
              recipientCount: message.recipients.length,
              intent: message.intent,
              topic: message.topic,
              ...(message.correlationId !== null && { correlationId: message.correlationId }),
              sessionId: message.sender.kind === 'agent' ? message.sender.id : null,
            },
          }),
        { discard: true },
      )
    }).pipe(Effect.ignore),
  ),
)

/**
 * Serve the local bridge and keep the unread counts fresh. Peer mail needs no per-Agent registration: a direct message
 * names its recipient, so the old workspace-topic subscription for every Agent is gone (it added thousands of rows and
 * almost nobody read the broadcasts).
 */
const Maintenance = Layer.effectDiscard(
  Effect.gen(function* () {
    const hub = yield* CommunicationHub
    const agents = yield* HostAgents
    const unread = yield* UnreadCounts
    const listAgents = yield* DshxPlugin.callback(() => agents.communicationAgents)
    const ownsBridge = yield* hub.serveBridge(listAgents)
    const reportFailure = (task: string) => (cause: unknown) => Effect.logWarning(`agent-communication: ${task} failed`, cause)
    // One pass at startup clears the subscriptions older versions created for every Agent and every workspace.
    yield* pruneWorkspaceTopics.pipe(Effect.catchCause(cause => Effect.logWarning('agent-communication: startup workspace topic cleanup failed', cause)))
    yield* DshxPlugin.worker(
      recurringTask({ run: unread.refresh, interval: Duration.millis(UnreadNudgeRules.refreshIntervalMs), onFailure: reportFailure('unread count refresh') }),
    )
    if (ownsBridge)
      yield* DshxPlugin.worker(
        recurringTask({ run: pruneWorkspaceTopics, interval: workspaceTopicCleanupInterval, onFailure: reportFailure('workspace topic maintenance') }),
      )
  }),
)

const HostServices = Layer.mergeAll(HostAgents.layer, SessionCorpus.layer, ThreadAgents.layer)

const WakeLive = MailWake.layer.pipe(Layer.provide(Layer.mergeAll(HostApis.layer, CommSettingsLive)))

const AgentCommunicationLive = Layer.mergeAll(Maintenance, ActivityBackfill, UnreadPrompt).pipe(
  Layer.provideMerge(Layer.mergeAll(UnreadCounts.layer, RecipientDirectory.layer, CommunicationOperations.layer, WakeLive)),
  Layer.provideMerge(Layer.mergeAll(CommunicationHub.layer, HostServices)),
)

export default DshxPlugin.make({
  name: 'agent-communication',
  inject: ['agents'],
  settings: [agentCommunicationSettings],
  layer: AgentCommunicationLive,
  tools: communicationTools,
  apis: [
    Api.bind(agentCommunicationApi, {
      diagnostics: input => CommunicationOperations.use(operations => operations.diagnostics(input.limit)),
      browseMessages: input => CommunicationOperations.use(operations => operations.browseMessages(input)),
      postMessage: input =>
        Effect.gen(function* () {
          const result = yield* CommunicationOperations.use(operations => operations.postMessage(input))
          if (result.topic === null && input.agentId !== undefined)
            yield* MailWake.use(wake =>
              wake.deliver({
                recipientId: input.agentId ?? '',
                senderId: 'communication-browser',
                senderLabel: 'the communication panel',
                messageId: result.messageId,
                intent: result.intent,
              }),
            )
          return result
        }),
      messageRecipients: input => CommunicationOperations.use(operations => operations.messageRecipients(input.messageId)),
      revealMessageBody: input => CommunicationOperations.use(operations => operations.revealMessageBody(input.messageId)),
      setSubscription: input => CommunicationOperations.use(operations => operations.setSubscription(input)),
      unsubscribe: input => CommunicationOperations.use(operations => operations.unsubscribe(input)),
      acknowledge: input => CommunicationOperations.use(operations => operations.acknowledge(input)),
    }),
  ],
})
