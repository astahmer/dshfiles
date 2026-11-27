import { AgentEditor } from './agent-editor.js'
import type { AgentDraft, AgentSubagents } from './agent.js'
import type { ToolAccessEditInput } from './api.js'
import { ToolTrees } from './tool-tree.js'

/**
 * What one press of Save sends. The registry stores an agent whole, but tool access, subagents and project defaults
 * have their own Host verbs: sending the sparse edits through them keeps a change another browser or an agent tool
 * made to an untouched entry, where a whole-agent save of the editor's copy would undo it.
 */
export interface AgentSavePlan {
  readonly handle: string
  /** The agent's own fields (identity, brief, model, delegation, memory); null when none changed. */
  readonly save: AgentDraft | null
  /** Tool access edits, one `setToolAccess` call per batch; one batch unless a save holds more than the Host takes. */
  readonly toolEdits: readonly (readonly ToolAccessEditInput[])[]
  readonly subagents: AgentSubagents | null
  /** Projects to point at this agent (handle) or to clear (null). */
  readonly projects: readonly { readonly projectId: string; readonly handle: string | null }[]
}

/** A project's default agent, by project id. */
export type ProjectDefaults = ReadonlyMap<string, string>

const sameSubagents = (left: AgentSubagents, right: AgentSubagents): boolean => JSON.stringify(left) === JSON.stringify(right)

/** The project ids whose default this agent is. */
const projectsOf = (defaults: ProjectDefaults, handle: string): ReadonlySet<string> =>
  new Set([...defaults].filter(([, owner]) => owner === handle).map(([projectId]) => projectId))

/**
 * The calls one save makes. A new agent is created whole (its tools and subagents ride the create); an existing one
 * sends only what changed. Project picks clear only a project whose default is still this agent.
 */
const of = (input: {
  readonly creating: boolean
  readonly base: AgentDraft
  /** Normalized for saving. */
  readonly draft: AgentDraft
  readonly defaults: ProjectDefaults
  /** The projects the editor wants this agent to be the default of; null when untouched. */
  readonly projects: ReadonlySet<string> | null
}): AgentSavePlan => {
  const { draft, base } = input
  const handle = draft.handle
  const wanted = input.projects ?? projectsOf(input.defaults, input.creating ? '' : base.handle)
  const current = input.creating ? new Set<string>() : projectsOf(input.defaults, handle)
  const projects = [
    ...[...wanted].filter(projectId => !current.has(projectId)).map(projectId => ({ projectId, handle })),
    ...[...current].filter(projectId => !wanted.has(projectId)).map(projectId => ({ projectId, handle: null })),
  ]
  if (input.creating) return { handle, save: draft, toolEdits: [], subagents: null, projects }
  const own = { ...draft, tools: base.tools, subagents: base.subagents }
  return {
    handle,
    save: AgentEditor.isDirty(own, base) ? own : null,
    toolEdits: ToolTrees.batches(ToolTrees.edits(base.tools, draft.tools)),
    subagents: sameSubagents(draft.subagents, base.subagents) ? null : draft.subagents,
    projects,
  }
}

const isEmpty = (plan: AgentSavePlan): boolean => plan.save === null && plan.toolEdits.length === 0 && plan.subagents === null && plan.projects.length === 0

export class AgentSavePlans {
  static readonly of = of
  static readonly isEmpty = isEmpty
  static readonly projectsOf = projectsOf
}
