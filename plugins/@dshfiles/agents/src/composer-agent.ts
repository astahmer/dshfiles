import { WorkspaceAttribution, type AttributedWorkspace } from '@dshfiles/vcs-provider-port/workspace-attribution'
import { Agents, DEFAULT_AGENT_HANDLE, type Agent } from './agent.js'
import { AgentReference } from './agent-reference.js'

/**
 * How a new thread's agent was chosen in the composer: a leading `@handle` in the message, the person's pick in the
 * agent chip, the project's default agent, or `@dsh` when none of those applies.
 */
export type ComposerAgentSource = 'mention' | 'choice' | 'project-default' | 'default'

export interface ComposerAgentResolution {
  readonly agent: Agent
  readonly source: ComposerAgentSource
}

/** What the first send does to start the thread as its agent. */
export interface ComposerAgentPlan {
  readonly agent: Agent
  readonly source: ComposerAgentSource
  /** Record the thread's agent on the Host: only when it differs from what the Host would decide (the project default or `@dsh`). */
  readonly record: boolean
  /** The Agent preset to apply, or null to keep the thread's own. */
  readonly preset: string | null
  /** Whether to open the message with the agent's identity and instructions, as a dispatch does. */
  readonly introduce: boolean
}

/** The wire spelling a picked mention chip sends (`@{handle}`), or a typed `@handle`, at the start of the message. */
const LEADING_WIRE_MENTION = /^\s*@\{([^}\s]{1,64})\}/u

const leadingMention = (text: string): string | null => {
  const wire = LEADING_WIRE_MENTION.exec(text)?.[1]
  if (wire !== undefined) return AgentReference.isHandle(wire) ? wire : null
  return Agents.mentionedHandle(text)
}

const usable = (agents: readonly Agent[], handle: string | null | undefined): Agent | undefined =>
  handle === null || handle === undefined ? undefined : agents.find(agent => agent.handle === handle && agent.enabled)

const fallbackAgent = (agents: readonly Agent[]): Agent => agents.find(agent => agent.handle === DEFAULT_AGENT_HANDLE) ?? Agents.builtIn(0)

/**
 * The agent a new thread starts as, in order: a leading mention of an enabled agent → the person's pick in the chip →
 * the project's default agent → `@dsh`. A handle that names no enabled agent is skipped, like the Host's resolution.
 */
const resolve = (input: {
  readonly agents: readonly Agent[]
  readonly projectDefault: string | null
  readonly choice: string | null
  readonly text?: string
}): ComposerAgentResolution => {
  const mentioned = usable(input.agents, input.text === undefined ? null : leadingMention(input.text))
  if (mentioned !== undefined) return { agent: mentioned, source: 'mention' }
  const chosen = usable(input.agents, input.choice)
  if (chosen !== undefined) return { agent: chosen, source: 'choice' }
  const projectDefault = usable(input.agents, input.projectDefault)
  if (projectDefault !== undefined) return { agent: projectDefault, source: 'project-default' }
  return { agent: fallbackAgent(input.agents), source: 'default' }
}

/**
 * The first send's plan. A slash command is not a request to the agent, so it sends as typed and leaves the thread
 * undecided (null). The Host decides the project default (or `@dsh`) itself when the thread's agent attaches, so an
 * agent equal to that decision is not recorded, which keeps the thread's source "project default" in its Tools
 * control. `decided` is the agent the Host already recorded for this Session, if any (a blank created before the
 * project got its default keeps `@dsh`): any other agent is recorded so its tools match its instructions.
 */
const plan = (input: {
  readonly agents: readonly Agent[]
  readonly projectDefault: string | null
  readonly choice: string | null
  readonly text: string
  readonly decided?: string | null
}): ComposerAgentPlan | null => {
  if (input.text.trimStart().startsWith('/')) return null
  const resolution = resolve(input)
  const hostDecides = input.decided ?? usable(input.agents, input.projectDefault)?.handle ?? DEFAULT_AGENT_HANDLE
  return {
    agent: resolution.agent,
    source: resolution.source,
    record: resolution.agent.handle !== hostDecides,
    preset: resolution.agent.preset,
    introduce: !resolution.agent.builtIn,
  }
}

/** The DSH project a (possibly still local) thread belongs to: its draft's workspace, else its Host cwd, else membership. */
const projectOf = (input: {
  readonly workspaces: readonly (AttributedWorkspace & { readonly path: string })[]
  readonly sessionId: string
  readonly draftWorkspaceId: string | undefined
  readonly cwd: string | undefined
}): string | undefined => {
  const draftPath = input.workspaces.find(workspace => workspace.workspaceId === input.draftWorkspaceId)?.path
  return WorkspaceAttribution.projectOfSession({ workspaces: input.workspaces, sessionId: input.sessionId, cwd: draftPath ?? input.cwd })
}

/** The project's default agent handle, or null. */
const projectDefaultOf = (defaults: readonly { readonly projectId: string; readonly handle: string }[], projectId: string | undefined): string | null =>
  projectId === undefined ? null : (defaults.find(row => row.projectId === projectId)?.handle ?? null)

const SOURCE_LABELS = {
  mention: 'from your mention',
  choice: 'for this thread',
  'project-default': 'project default',
  default: 'default',
} as const satisfies Record<ComposerAgentSource, string>

/** Plain words for the chip's caption and the menu. */
const sourceLabel = (source: ComposerAgentSource): string => SOURCE_LABELS[source]

/** Pure rules behind the composer's agent: who a new thread starts as and what its first send does. */
export class ComposerAgent {
  static readonly leadingMention = leadingMention
  static readonly resolve = resolve
  static readonly plan = plan
  static readonly projectOf = projectOf
  static readonly projectDefaultOf = projectDefaultOf
  static readonly sourceLabel = sourceLabel
}
