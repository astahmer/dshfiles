import { AGENT_DELEGATION_UNRESTRICTED, AGENT_HANDLE_PATTERN, agentLimits, Agents, type Agent, type AgentDraft, type AgentRoute } from './agent.js'
import type { AgentModelOption } from './dispatch.js'

/** The fields the editor can flag; each maps to one control so a message sits under the field it is about. */
export type AgentField = 'name' | 'handle' | 'glyph' | 'memoryScope' | 'peers' | 'route' | 'instructions' | 'routine'

/** A problem with a recovery the editor can offer as a button, so no message is a dead end. */
export type AgentFix =
  | { readonly kind: 'open-agent'; readonly handle: string; readonly label: string }
  | { readonly kind: 'use-handle'; readonly handle: string; readonly label: string }
  | { readonly kind: 'clear-memory-scope'; readonly label: string }
  | { readonly kind: 'messaging-none'; readonly label: string }
  | { readonly kind: 'reset-route'; readonly label: string }

export interface AgentIssue {
  readonly field: AgentField
  readonly message: string
  readonly fix?: AgentFix
}

export interface AgentReview {
  /** Problems that block saving. */
  readonly errors: readonly AgentIssue[]
  /** Saves fine, but the person should know: an unknown peer, a clipped opening message, a route the Host lacks. */
  readonly warnings: readonly AgentIssue[]
  /** The handle a save would store, after a new agent's name or handle is slugged. */
  readonly handle: string
}

/** A starting point for a new agent; only the fields a person would otherwise type. */
export interface AgentTemplate {
  readonly id: string
  readonly name: string
  readonly glyph: string
  readonly description: string
  readonly instructions: string
}

const MEMORY_SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/u
const MAX_MEMORY_SCOPE_CHARS = 80
const MAX_GLYPH_CHARS = 8
/** The glyphs offered as one-tap choices; any emoji or short text still works in the field. */
export const AGENT_GLYPHS: readonly string[] = ['🤖', '🔍', '🧭', '🛠', '✍️', '🧪', '📐', '🛡', '📚', '⚡']

export const AGENT_TEMPLATES: readonly AgentTemplate[] = [
  {
    id: 'reviewer',
    name: 'Reviewer',
    glyph: '🔍',
    description: 'Reviews diffs and pull requests',
    instructions:
      'Review the change for correctness first, then risk, then style.\nReport each finding with a file:line reference, why it matters and the smallest fix.\nSay plainly when you find nothing worth changing.',
  },
  {
    id: 'planner',
    name: 'Planner',
    glyph: '🧭',
    description: 'Turns a vague ask into a plan',
    instructions:
      'Restate the goal in one sentence, then list the open questions.\nBreak the work into small milestones, each with acceptance criteria and a way to verify it.\nDo not start implementing until the plan is agreed.',
  },
  {
    id: 'explainer',
    name: 'Explainer',
    glyph: '📚',
    description: 'Explains code and decisions in plain words',
    instructions:
      'Answer for someone new to this codebase.\nStart with the short answer, then walk through the relevant files with links.\nPrefer one concrete example over an abstract description.',
  },
]

/** The opening message's fixed overhead around the preamble: the header line, separators and a short task. */
const OPENING_OVERHEAD = 160

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

const routeKey = (route: AgentRoute): string => `${route.provider}/${route.model}`

/** Pure editor rules behind the Agents panel: draft shape, dirtiness, review, duplicate and templates. */
export class AgentEditor {
  /** The editable fields of a saved agent (or another draft), in one fixed key order; a blank draft for null. */
  static draftOf(agent: AgentDraft | null): AgentDraft {
    return {
      handle: agent?.handle ?? '',
      name: agent?.name ?? '',
      glyph: agent?.glyph ?? '🤖',
      description: agent?.description ?? '',
      instructions: agent?.instructions ?? '',
      preset: agent?.preset ?? null,
      route: AgentEditor.route(agent?.route ?? null),
      memoryScope: agent?.memoryScope ?? null,
      routine: agent?.routine ?? '',
      delegation:
        agent === null
          ? { ...AGENT_DELEGATION_UNRESTRICTED, handles: [] }
          : { messaging: agent.delegation.messaging, handles: [...agent.delegation.handles], subagents: agent.delegation.subagents },
      enabled: agent?.enabled ?? true,
    }
  }

  /** A route in fixed key order, without an absent effort key, so two equal routes compare equal. */
  static route(route: AgentRoute | null): AgentRoute | null {
    if (route === null) return null
    return route.reasoningEffort === undefined
      ? { provider: route.provider, model: route.model }
      : { provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort }
  }

  /** Whether a draft differs from what it was opened from; key order is the draft's own, so JSON compares. */
  static isDirty(draft: AgentDraft, base: AgentDraft): boolean {
    return !sameJson(AgentEditor.draftOf(draft), AgentEditor.draftOf(base))
  }

  /** Typing in the handle field: lowercase, spaces become dashes, anything a handle cannot hold is dropped. */
  static typedHandle(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/gu, '-')
      .replace(/[^a-z0-9-]/gu, '')
      .slice(0, 32)
  }

  /** Peers typed as `@a, b c`: split on commas or spaces, `@` dropped, duplicates removed, order kept. */
  static parsePeers(text: string): string[] {
    const handles = text
      .split(/[\s,]+/u)
      .map(handle => handle.trim().replace(/^@/u, '').toLowerCase())
      .filter(handle => handle !== '')
    return [...new Set(handles)]
  }

  /** A free handle near `base`: `base`, then `base-2`, `base-3`… within the 32-character limit. */
  static uniqueHandle(base: string, taken: ReadonlySet<string>): string {
    const root = Agents.handleFrom(base)
    if (!taken.has(root)) return root
    for (let index = 2; index < 1_000; index += 1) {
      const suffix = `-${String(index)}`
      const candidate = `${root.slice(0, 32 - suffix.length)}${suffix}`
      if (!taken.has(candidate)) return candidate
    }
    return root
  }

  /** A copy to edit before saving: everything but the identity, which must stay unique. */
  static duplicate(agent: Agent, agents: readonly Agent[]): AgentDraft {
    const taken = new Set(agents.map(candidate => candidate.handle))
    const name = `${agent.name} copy`.slice(0, agentLimits.name)
    return {
      ...AgentEditor.draftOf(agent),
      name,
      handle: AgentEditor.uniqueHandle(`${agent.handle}-copy`, taken),
      // An explicit default scope would make the copy read the original's notes; the copy falls back to its own default.
      memoryScope: agent.memoryScope === Agents.defaultMemoryScope(agent.handle) ? null : agent.memoryScope,
      enabled: true,
    }
  }

  static fromTemplate(template: AgentTemplate, agents: readonly Agent[]): AgentDraft {
    const taken = new Set(agents.map(candidate => candidate.handle))
    return {
      ...AgentEditor.draftOf(null),
      name: template.name,
      handle: AgentEditor.uniqueHandle(template.id, taken),
      glyph: template.glyph,
      description: template.description,
      instructions: template.instructions,
    }
  }

  /** How a route reads in a list: the catalog's names, or the raw ids when this Host does not offer it. */
  static routeLabel(route: AgentRoute | null, options: readonly AgentModelOption[]): string {
    if (route === null) return 'Harness default'
    const option = options.find(candidate => candidate.key === routeKey(route))
    const model = option === undefined ? route.model : option.modelName
    return route.reasoningEffort === undefined ? model : `${model} · ${route.reasoningEffort}`
  }

  /** Characters of the opening message the instructions and routine would take before the task. */
  static preambleChars(draft: AgentDraft): number {
    const routine = Agents.routineSection(draft.routine)
    return draft.instructions.trim().length + (routine === '' ? 0 : routine.length + 2) + draft.name.length + draft.description.length
  }

  /**
   * Everything the save button needs to know. `catalog` is null while the model list loads, so a pinned route is not
   * reported missing before the Host answered.
   */
  static review(
    draft: AgentDraft,
    context: { readonly creating: boolean; readonly agents: readonly Agent[]; readonly catalog: readonly AgentModelOption[] | null },
  ): AgentReview {
    const errors: AgentIssue[] = []
    const warnings: AgentIssue[] = []
    const handle = context.creating ? Agents.handleFrom(draft.handle === '' ? draft.name : draft.handle) : draft.handle
    const taken = new Set(context.agents.map(agent => agent.handle))

    if (draft.name.trim() === '') errors.push({ field: 'name', message: 'Give the agent a name; lists and mentions show it.' })
    else if (draft.name.trim().length > agentLimits.name) errors.push({ field: 'name', message: `Keep the name under ${String(agentLimits.name)} characters.` })

    if (context.creating) {
      if (draft.handle !== '' && !AGENT_HANDLE_PATTERN.test(draft.handle)) {
        errors.push({
          field: 'handle',
          message: 'A handle starts with a letter and holds only lowercase letters, digits and dashes.',
          fix: { kind: 'use-handle', handle, label: `Use @${handle}` },
        })
      } else if (taken.has(handle) && (draft.handle !== '' || draft.name.trim() !== '')) {
        const free = AgentEditor.uniqueHandle(handle, taken)
        errors.push({
          field: 'handle',
          message: `@${handle} is already an agent. Saving would replace it.`,
          fix: { kind: 'use-handle', handle: free, label: `Use @${free}` },
        })
      }
    }

    if (draft.glyph.trim().length > MAX_GLYPH_CHARS)
      errors.push({ field: 'glyph', message: `A glyph is one emoji or up to ${String(MAX_GLYPH_CHARS)} characters.` })

    const scope = draft.memoryScope?.trim() ?? ''
    if (scope !== '' && (scope.length > MAX_MEMORY_SCOPE_CHARS || !MEMORY_SCOPE_PATTERN.test(scope))) {
      errors.push({
        field: 'memoryScope',
        message: `Use letters, digits and : . _ / - (up to ${String(MAX_MEMORY_SCOPE_CHARS)}), starting with a letter or digit.`,
        fix: { kind: 'clear-memory-scope', label: `Use ${Agents.defaultMemoryScope(handle)}` },
      })
    }

    if (draft.delegation.messaging === 'listed') {
      const invalid = draft.delegation.handles.filter(peer => !AGENT_HANDLE_PATTERN.test(peer))
      if (draft.delegation.handles.length === 0) {
        errors.push({
          field: 'peers',
          message: 'List at least one peer this agent may message.',
          fix: { kind: 'messaging-none', label: 'Allow no messaging instead' },
        })
      } else if (invalid.length > 0) {
        errors.push({ field: 'peers', message: `${invalid.map(peer => `"${peer}"`).join(', ')} is not a handle: lowercase letters, digits and dashes.` })
      } else {
        const unknown = draft.delegation.handles.filter(peer => !taken.has(peer) && peer !== handle)
        if (unknown.length > 0)
          warnings.push({
            field: 'peers',
            message: `${unknown.map(peer => `@${peer}`).join(', ')} is not a saved agent yet; messages to it are refused until it exists.`,
          })
      }
    }

    const route = draft.route
    if (route !== null && context.catalog !== null && !context.catalog.some(option => option.key === routeKey(route))) {
      warnings.push({
        field: 'route',
        message: `${route.provider}/${route.model} is not offered by this Host, so its threads use the harness default model.`,
        fix: { kind: 'reset-route', label: 'Use the harness default' },
      })
    }

    if (draft.instructions.length > agentLimits.instructions)
      errors.push({ field: 'instructions', message: `Instructions hold up to ${agentLimits.instructions.toLocaleString('en-US')} characters.` })
    else {
      const overflow = AgentEditor.preambleChars(draft) + OPENING_OVERHEAD - agentLimits.message
      if (overflow > 0)
        warnings.push({
          field: 'instructions',
          message: `The opening message is capped at ${agentLimits.message.toLocaleString('en-US')} characters, so about ${overflow.toLocaleString('en-US')} characters of these instructions will be cut. The task itself is never cut.`,
        })
    }

    if (draft.routine.length > agentLimits.routine)
      errors.push({ field: 'routine', message: `A routine holds up to ${String(agentLimits.routine)} characters.` })

    return { errors, warnings, handle }
  }

  /** The issue for one field, errors first, so a control shows one message at a time. */
  static issueFor(review: AgentReview, field: AgentField): { readonly issue: AgentIssue; readonly severity: 'error' | 'warning' } | null {
    const error = review.errors.find(issue => issue.field === field)
    if (error !== undefined) return { issue: error, severity: 'error' }
    const warning = review.warnings.find(issue => issue.field === field)
    return warning === undefined ? null : { issue: warning, severity: 'warning' }
  }
}
