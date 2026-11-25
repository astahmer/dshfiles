import type { Agent } from './agent.js'
import type { ThreadAccessView, ThreadToolOverrideRequest } from './thread-agents.js'

/** One choice of the Tools menu: another agent's tool set or every tool. The thread's own agent clears the override. */
export type ThreadToolsValue = `agent:${string}` | 'all'

/** What the Tools control shows for one running thread. */
export interface ThreadToolsState {
  /** The thread's agent handle, without `@`. */
  readonly agent: string
  /** How the agent was decided, in plain words: agent, project default, override or default. */
  readonly source: string
  /** Whose tools apply now: "@reviewer's tools" or "All tools". */
  readonly tools: string
  /** The checked menu value. */
  readonly value: ThreadToolsValue
  /** Whether an override is set, so Reset applies. */
  readonly overridden: boolean
  /** Whether the Host has decided this thread's agent; false is a preview of what its first request would decide. */
  readonly recorded: boolean
}

const SOURCE_LABELS = {
  agent: 'agent',
  'project-default': 'project default',
  override: 'override',
  default: 'default',
} as const satisfies Record<ThreadAccessView['policy']['source'], string>

const sourceOf = (view: ThreadAccessView): string => SOURCE_LABELS[view.policy.source]

const state = (view: ThreadAccessView): ThreadToolsState => {
  const override = view.agent.override
  const value: ThreadToolsValue = override === null ? `agent:${view.agent.handle}` : override.kind === 'all' ? 'all' : `agent:${override.handle}`
  return {
    agent: view.agent.handle,
    source: sourceOf(view),
    tools: override?.kind === 'all' ? 'All tools' : `@${override?.kind === 'agent' ? override.handle : view.agent.handle}'s tools`,
    value,
    overridden: override !== null,
    recorded: view.recorded,
  }
}

/** The override a menu choice asks the Host for; the thread's own agent clears it. */
const requestFor = (value: ThreadToolsValue, threadAgent: string): ThreadToolOverrideRequest => {
  if (value === 'all') return { kind: 'all' }
  const handle = value.slice('agent:'.length)
  return handle === threadAgent ? null : { kind: 'agent', handle }
}

/** The agents the menu offers: enabled ones, the thread's own first. */
const choices = (agents: readonly Agent[], threadAgent: string): readonly Agent[] =>
  [...agents.filter(agent => agent.enabled || agent.handle === threadAgent)].sort(
    (left, right) => Number(right.handle === threadAgent) - Number(left.handle === threadAgent),
  )

/** Pure rules behind a running thread's Tools control. */
export class ThreadTools {
  static readonly state = state
  static readonly requestFor = requestFor
  static readonly choices = choices
  static readonly isValue = (value: string): value is ThreadToolsValue => value === 'all' || value.startsWith('agent:')
}
