import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  ConversationMatch,
  ConversationNodeDefinitionInput,
  ConversationViewDefinition,
  ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { LiveActivity, type ActivityEvent, type ActivityState, type LiveActivity as LiveActivityView } from './live-activity.js'
import { PlanProgress, type PlanWrite } from './plan-progress.js'

export const PLAN_TARGET = 'dshfiles-agent-plan'
export const ACTIVITY_TARGET = 'dshfiles-agent-activity'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    /** Every loaded `todo/write`, oldest first, published by @dshfiles/agent-plan. */
    'dshfiles-agent-plan': readonly PlanWrite[]
    /** What runs now in the Session, published by @dshfiles/agent-plan. */
    'dshfiles-agent-activity': LiveActivityView
  }
}

const turnOf = (match: ConversationMatch): number | undefined =>
  match.location.kind === 'turn' || match.location.kind === 'step' ? match.location.turn.turn : undefined

const field = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined)
const stringField = (value: unknown, key: string): string | undefined => {
  const found = field(value, key)
  return typeof found === 'string' ? found : undefined
}

/** One Context per durable `todo/write`, so each write keeps the time and turn its own event carries. */
const planWriteDefinition: ConversationNodeDefinitionInput<PlanWrite> = {
  kind: 'dshfiles-agent-plan-write',
  target: PLAN_TARGET,
  match: { 'todo/write': (event: SessionEventLike) => ({ id: String('seq' in event ? event.seq : 0), role: 'start' }) },
  start: (_context, match) => {
    const event = match.event
    return {
      seq: 'seq' in event ? event.seq : 0,
      time: 'time' in event ? event.time : Date.now(),
      turn: turnOf(match),
      todos: PlanProgress.itemsOf(field(event.data, 'todos')) ?? [],
    }
  },
  update: context => context.state,
  buildViewNode: context =>
    context.state === undefined ? null : { key: context.key, kind: context.kind, id: context.id, target: PLAN_TARGET, data: context.state },
}

const planView: ConversationViewDefinition<ConversationViewNode, readonly PlanWrite[]> = {
  target: PLAN_TARGET,
  create: () => {
    const writes = new Map<string, PlanWrite>()
    const snapshot = (): readonly PlanWrite[] => [...writes.values()].toSorted((left, right) => left.seq - right.seq)
    const empty: readonly PlanWrite[] = []
    return {
      empty,
      replace: ({ nodes }) => {
        writes.clear()
        // SAFETY: every node of this target is built by planWriteDefinition, whose data is a PlanWrite.
        for (const node of nodes) writes.set(node.id, node.data as PlanWrite)
        return snapshot()
      },
      apply: ({ upserts }) => {
        // SAFETY: as above, this target's nodes carry PlanWrite data.
        for (const node of upserts) writes.set(node.id, node.data as PlanWrite)
        return snapshot()
      },
    }
  },
}

const activityEventOf = (event: SessionEventLike): ActivityEvent | undefined => {
  const data: unknown = event.data
  const time = 'time' in event ? event.time : Date.now()
  // `job/*` events are declared by @deepseek-ai/dsh-jobs, which this client does not import; read the type as text.
  const type: string = event.type
  switch (type) {
    case 'turn/start':
      return { type: 'turn-start', turn: Number(field(data, 'turn')) }
    case 'turn/end':
      return { type: 'turn-end', turn: Number(field(data, 'turn')) }
    case 'tool/call': {
      const callId = stringField(data, 'callId')
      const name = stringField(data, 'name')
      return callId === undefined || name === undefined ? undefined : { type: 'tool-call', callId, name, time }
    }
    case 'tool/result': {
      const callId = stringField(field(data, 'message'), 'toolCallId')
      return callId === undefined ? undefined : { type: 'tool-result', callId }
    }
    case 'job/registered': {
      const jobId = stringField(data, 'jobId')
      if (jobId === undefined) return undefined
      const startedAt = field(data, 'startedAt')
      return {
        type: 'job-registered',
        job: { jobId, kind: stringField(data, 'kind') ?? 'job', label: stringField(data, 'label') ?? jobId, startedAt: typeof startedAt === 'number' ? startedAt : time },
      }
    }
    case 'job/settled': {
      const jobId = stringField(data, 'jobId')
      return jobId === undefined ? undefined : { type: 'job-settled', jobId }
    }
    default:
      return undefined
  }
}

const ACTIVITY_EVENTS = ['turn/start', 'turn/end', 'tool/call', 'tool/result', 'job/registered', 'job/settled'] as const
const activityMatch = (event: SessionEventLike) => (activityEventOf(event) === undefined ? null : { id: 'session', role: 'start' as const })

/** One Session-wide Context that folds tool calls, results and job records into what runs now. */
const activityDefinition: ConversationNodeDefinitionInput<ActivityState> = {
  kind: 'dshfiles-agent-activity',
  target: ACTIVITY_TARGET,
  match: Object.fromEntries(ACTIVITY_EVENTS.map(type => [type, activityMatch])),
  start: (_context, match) => {
    const event = activityEventOf(match.event)
    return event === undefined ? LiveActivity.empty : LiveActivity.apply(LiveActivity.empty, event)
  },
  update: (context, match) => {
    const event = activityEventOf(match.event)
    return event === undefined ? context.state : LiveActivity.apply(context.state, event)
  },
  publication: () => 'animation-frame',
  buildViewNode: context =>
    context.state === undefined
      ? null
      : { key: context.key, kind: context.kind, id: context.id, target: ACTIVITY_TARGET, data: LiveActivity.view(context.state) },
}

const IDLE: LiveActivityView = { turn: undefined, tools: [], jobs: [], subagents: [] }

const activityView: ConversationViewDefinition<ConversationViewNode, LiveActivityView> = {
  target: ACTIVITY_TARGET,
  create: () => {
    // SAFETY: this target's only node is built by activityDefinition, whose data is a LiveActivity view.
    const latest = (nodes: readonly ConversationViewNode[], fallback: LiveActivityView): LiveActivityView => (nodes.at(-1)?.data as LiveActivityView | undefined) ?? fallback
    let current = IDLE
    return {
      empty: IDLE,
      replace: ({ nodes }) => (current = latest(nodes, IDLE)),
      apply: ({ upserts }) => (current = latest(upserts, current)),
    }
  },
}

/** What @dshfiles/agent-plan registers on `ctx.uiConversation`: two event Definitions and their view targets. */
export const ConversationTargets = { planWriteDefinition, planView, activityDefinition, activityView }
