import type {} from '@deepseek-ai/dsh-agent'
import { Api, DshxPlugin, HostEvents } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Duration, Effect, Layer } from 'effect'
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
    yield* hub.serveBridge(listAgents)
    const reportFailure = (task: string) => (cause: unknown) => Effect.logWarning(`agent-communication: ${task} failed`, cause)
    yield* DshxPlugin.worker(
      recurringTask({ run: unread.refresh, interval: Duration.millis(UnreadNudgeRules.refreshIntervalMs), onFailure: reportFailure('unread count refresh') }),
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
      acknowledge: input => CommunicationOperations.use(operations => operations.acknowledge(input)),
    }),
  ],
})
