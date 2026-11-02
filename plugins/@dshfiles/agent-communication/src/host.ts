import type {} from '@deepseek-ai/dsh-agent'
import { Api, DshxPlugin, HostEvents } from '@dshfiles/dshx/effect'
import { Clock, Duration, Effect, Layer, Option } from 'effect'
import { registerCommunicationAgent, cleanupInactiveWorkspaceChannels } from './agent-lifecycle.js'
import { agentCommunicationApi } from './api.js'
import { CommunicationOperations } from './api-operations.js'
import { CommunicationHub } from './communication-hub-promise.js'
import { communicationTools } from './communication-tools.js'
import { HostAgents, SessionCorpus, ThreadAgents, onAgentCreated } from './host-edge-promise.js'
import { RecipientDirectory } from './recipient-directory.js'
import { recurringTask } from './recurring-task.js'
import { UnreadCounts, UnreadPrompt } from './unread-counts.js'
import { UnreadNudgeRules } from './unread-nudge.js'

const workspaceTopicCleanupInterval = Duration.hours(1)

/** Prune workspace topics no persisted Session or live Agent uses; without a Session corpus there is nothing to compare. */
const workspaceTopicCleanup = Effect.gen(function* () {
  const corpus = yield* SessionCorpus
  const agents = yield* HostAgents
  const listed = yield* corpus.listSessions.pipe(
    Effect.map(Option.some),
    Effect.catchTag('HostLookupFailed', error => (error.reason === 'unavailable' ? Effect.succeedNone : Effect.fail(error))),
  )
  if (Option.isNone(listed)) return
  const records = listed.value
  const removed = yield* cleanupInactiveWorkspaceChannels({
    sessionCwds: records.map(record => record.header.cwd),
    liveAgentCwds: (yield* agents.list).map(agent => agent.session.header.cwd),
    now: yield* Clock.currentTimeMillis,
  })
  if (removed > 0) yield* Effect.logInfo(`agent-communication: pruned ${removed} inactive orphaned workspace channel(s)`)
}).pipe(Effect.withSpan('agent communication workspace topic cleanup'))

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
 * Register every Agent for peer messages (live ones now, new ones as they are created), serve the local bridge, and keep
 * the unread counts and workspace topics fresh while the plugin runs.
 */
const Maintenance = Layer.effectDiscard(
  Effect.gen(function* () {
    const hub = yield* CommunicationHub
    const agents = yield* HostAgents
    const unread = yield* UnreadCounts
    yield* onAgentCreated(agent =>
      registerCommunicationAgent({ agentId: agent.id, workspaceCwd: agent.session.header.cwd }).pipe(
        // agent/created listeners run in series inside session/create; a new Agent has nothing unread, so the counts of
        // every other live Agent refresh after the thread is created instead of before.
        Effect.andThen(unread.refreshInBackground),
      ),
    )
    const listAgents = yield* DshxPlugin.callback(() => agents.communicationAgents)
    const ownsBridge = yield* hub.serveBridge(listAgents)
    yield* Effect.forEach(yield* agents.list, agent => registerCommunicationAgent({ agentId: agent.id, workspaceCwd: agent.session.header.cwd }), {
      discard: true,
    })
    const reportFailure = (task: string) => (cause: unknown) => Effect.logWarning(`agent-communication: ${task} failed`, cause)
    yield* DshxPlugin.worker(
      recurringTask({ run: unread.refresh, interval: Duration.millis(UnreadNudgeRules.refreshIntervalMs), onFailure: reportFailure('unread count refresh') }),
    )
    if (ownsBridge)
      yield* DshxPlugin.worker(
        recurringTask({ run: workspaceTopicCleanup, interval: workspaceTopicCleanupInterval, onFailure: reportFailure('workspace topic maintenance') }),
      )
  }),
)

const HostServices = Layer.mergeAll(HostAgents.layer, SessionCorpus.layer, ThreadAgents.layer)

const AgentCommunicationLive = Layer.mergeAll(Maintenance, ActivityBackfill, UnreadPrompt).pipe(
  Layer.provideMerge(Layer.mergeAll(UnreadCounts.layer, RecipientDirectory.layer, CommunicationOperations.layer)),
  Layer.provideMerge(Layer.mergeAll(CommunicationHub.layer, HostServices)),
)

export default DshxPlugin.make({
  name: 'agent-communication',
  inject: ['agents'],
  layer: AgentCommunicationLive,
  tools: communicationTools,
  apis: [
    Api.bind(agentCommunicationApi, {
      diagnostics: input => CommunicationOperations.use(operations => operations.diagnostics(input.limit)),
      browseMessages: input => CommunicationOperations.use(operations => operations.browseMessages(input)),
      postMessage: input => CommunicationOperations.use(operations => operations.postMessage(input)),
      messageRecipients: input => CommunicationOperations.use(operations => operations.messageRecipients(input.messageId)),
      revealMessageBody: input => CommunicationOperations.use(operations => operations.revealMessageBody(input.messageId)),
      setSubscription: input => CommunicationOperations.use(operations => operations.setSubscription(input)),
      unsubscribe: input => CommunicationOperations.use(operations => operations.unsubscribe(input)),
      acknowledge: input => CommunicationOperations.use(operations => operations.acknowledge(input)),
    }),
  ],
})
