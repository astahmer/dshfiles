import { TOOL_ACCESS_ALL, type ToolAccessPolicy, toolAccessPolicySchema, toolAccessSchema } from '@dshfiles/tool-search/access'
import { Schema } from 'effect'
import { AGENT_HANDLE_PATTERN, DEFAULT_AGENT_HANDLE, MAX_SESSION_CHARS, type Agent } from './agent.js'

const handleSchema = Schema.String.check(Schema.isPattern(AGENT_HANDLE_PATTERN))
const sessionIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SESSION_CHARS))
const timestampSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
/** A DSH project: the registered workspace id of a project checkout (never one of its thread workspaces). */
export const projectIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SESSION_CHARS))

/** Sessions whose agent is remembered; the oldest decision is dropped past it, so the table stays bounded. */
export const MAX_THREAD_AGENTS = 5_000

/**
 * How a thread's agent was decided, once, when its DSH agent attached. `explicit`: a dispatch, a mention or a subagent
 * started with an agent recorded it; `inherited`: a subagent took its parent thread's agent; `project-default`: the
 * project's default agent; `default`: none of those, so the built-in `@dsh`.
 */
export const threadAgentResolutionSchema = Schema.Literals(['explicit', 'inherited', 'project-default', 'default'])
export type ThreadAgentResolution = typeof threadAgentResolutionSchema.Type

/** A per-thread override of the tool set: another agent's tools (as they were when chosen) or every tool. */
export const threadToolOverrideSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('agent'), handle: handleSchema, access: toolAccessSchema }),
  Schema.Struct({ kind: Schema.Literal('all') }),
])
export type ThreadToolOverride = typeof threadToolOverrideSchema.Type

/** What a caller asks for: another agent's tools by handle, every tool, or null to clear the override. */
export const threadToolOverrideRequestSchema = Schema.NullOr(
  Schema.Union([Schema.Struct({ kind: Schema.Literal('agent'), handle: handleSchema }), Schema.Struct({ kind: Schema.Literal('all') })]),
)
export type ThreadToolOverrideRequest = typeof threadToolOverrideRequestSchema.Type

/**
 * One thread's agent, decided once and kept: the thread keeps this agent and the tool set it had then, so later edits
 * to the agent or to the project default reach only threads started afterwards.
 */
export const threadAgentSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  handle: handleSchema,
  resolution: threadAgentResolutionSchema,
  /** The project the thread was attributed to when decided, when it had one. */
  projectId: Schema.NullOr(projectIdSchema),
  /** The parent Session a subagent inherited its agent from. */
  inheritedFrom: Schema.NullOr(sessionIdSchema),
  /** The agent's tool access when the thread's agent was decided. */
  access: toolAccessSchema,
  decidedAt: timestampSchema,
  override: Schema.NullOr(threadToolOverrideSchema),
})
export type ThreadAgent = typeof threadAgentSchema.Type

/** A project's default agent, keyed by the project's workspace id. */
export const projectDefaultSchema = Schema.Struct({
  projectId: projectIdSchema,
  handle: handleSchema,
  updatedAt: timestampSchema,
})
export type ProjectDefault = typeof projectDefaultSchema.Type

/** A thread's agent and the tool policy it resolves to, as the API reports it; `recorded: false` is a preview. */
export const threadAccessViewSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  recorded: Schema.Boolean,
  agent: threadAgentSchema,
  policy: toolAccessPolicySchema,
})
export type ThreadAccessView = typeof threadAccessViewSchema.Type

/** What resolution reads about one Session: its id, its parent when it is a subagent, and the project it belongs to. */
export interface ThreadSubject {
  readonly sessionId: string
  readonly parentSessionId: string | undefined
  readonly projectId: string | undefined
}

/** The registry state resolution reads. */
export interface ThreadAgentsState {
  readonly agents: ReadonlyMap<string, Agent>
  /** Threads a dispatch recorded (the agents' `threads` table): sessionId → handle. */
  readonly dispatched: ReadonlyMap<string, string>
  readonly decided: ReadonlyMap<string, ThreadAgent>
  readonly projectDefaults: ReadonlyMap<string, ProjectDefault>
}

const accessOf = (agents: ReadonlyMap<string, Agent>, handle: string) => {
  const agent = agents.get(handle)
  return agent === undefined ? { tools: {}, groups: {} } : { tools: { ...agent.tools.tools }, groups: { ...agent.tools.groups } }
}

/**
 * The thread's agent, in order: explicit (a recorded dispatch or mention) → a subagent's parent thread's agent → the
 * project's default agent → `@dsh`. A handle that no longer names an agent is skipped, so a removed project default
 * falls back to `@dsh`.
 */
const decide = (state: ThreadAgentsState, subject: ThreadSubject, now: number): ThreadAgent => {
  const base = { sessionId: subject.sessionId, projectId: subject.projectId ?? null, decidedAt: now, override: null, inheritedFrom: null }
  const explicit = state.dispatched.get(subject.sessionId)
  if (explicit !== undefined && state.agents.has(explicit))
    return { ...base, handle: explicit, resolution: 'explicit', access: accessOf(state.agents, explicit) }
  if (subject.parentSessionId !== undefined) {
    const parent = state.decided.get(subject.parentSessionId)?.handle ?? state.dispatched.get(subject.parentSessionId)
    if (parent !== undefined && state.agents.has(parent))
      return { ...base, handle: parent, resolution: 'inherited', inheritedFrom: subject.parentSessionId, access: accessOf(state.agents, parent) }
  }
  const projectDefault = subject.projectId === undefined ? undefined : state.projectDefaults.get(subject.projectId)?.handle
  if (projectDefault !== undefined && state.agents.has(projectDefault))
    return { ...base, handle: projectDefault, resolution: 'project-default', access: accessOf(state.agents, projectDefault) }
  return { ...base, handle: DEFAULT_AGENT_HANDLE, resolution: 'default', access: accessOf(state.agents, DEFAULT_AGENT_HANDLE) }
}

const changeHint = (record: ThreadAgent): string =>
  record.override === null
    ? `To change it, edit @${record.handle}'s tools in the Agents panel (agents_tool_access_set; threads started afterwards get it), or override this thread's tools (agents_thread_override_set).`
    : `To change it, clear or change this thread's override (agents_thread_override_set), which applies from its next request.`

/** The tool policy one thread's record resolves to, in the `@dshfiles/tool-search/access` contract. */
const policyOf = (record: ThreadAgent): ToolAccessPolicy => {
  if (record.override !== null)
    return {
      agent: record.handle,
      source: 'override',
      toolsFrom: record.override.kind === 'all' ? null : record.override.handle,
      access: record.override.kind === 'all' ? TOOL_ACCESS_ALL : record.override.access,
      change: changeHint(record),
    }
  return {
    agent: record.handle,
    source: record.resolution === 'project-default' ? 'project-default' : record.resolution === 'default' ? 'default' : 'agent',
    toolsFrom: record.handle,
    access: record.access,
    change: changeHint(record),
  }
}

/** The override a request names, with the named agent's current tools; undefined when that agent does not exist. */
const overrideOf = (agents: ReadonlyMap<string, Agent>, request: ThreadToolOverrideRequest): ThreadToolOverride | null | undefined => {
  if (request === null) return null
  if (request.kind === 'all') return { kind: 'all' }
  return agents.has(request.handle) ? { kind: 'agent', handle: request.handle, access: accessOf(agents, request.handle) } : undefined
}

/** The decisions to drop so at most `max` remain: the oldest first. */
const overflow = (decided: ReadonlyMap<string, ThreadAgent>, max = MAX_THREAD_AGENTS): string[] =>
  decided.size <= max
    ? []
    : [...decided.values()]
        .sort((left, right) => left.decidedAt - right.decidedAt)
        .slice(0, decided.size - max)
        .map(record => record.sessionId)

/** Pure rules behind each thread's agent: resolution order, the tool policy, overrides and retention. */
export class ThreadAgents {
  static readonly decide = decide
  static readonly policyOf = policyOf
  static readonly overrideOf = overrideOf
  static readonly overflow = overflow
}
