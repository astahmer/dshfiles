import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'
import { toolAccessEntrySchema, toolAccessSchema, toolGroupKindSchema } from '@dshfiles/tool-search/access'
import { AGENT_HANDLE_PATTERN, agentDraftSchema, agentSchema, agentSubagentsSchema, agentThreadSchema, MAX_SESSION_CHARS } from './agent.js'
import { projectDefaultSchema, projectIdSchema, threadAccessViewSchema, threadToolOverrideRequestSchema } from './thread-agents.js'

const handleSchema = Schema.String.check(Schema.isPattern(AGENT_HANDLE_PATTERN))
const writeNote = 'May run only when the user asked for that change.'
const sessionIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SESSION_CHARS))
const MAX_TOOL_EDITS = 200
const destructiveNote = 'Destructive: requires `confirm: true`, which is never implied by a bare request.'

export const agentSnapshotSchema = Schema.Struct({
  revision: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  agents: Schema.Array(agentSchema),
})

export const agentSaveResultSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('applied'),
    revision: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
    agents: Schema.Array(agentSchema),
    agent: agentSchema,
  }),
  Schema.Struct({ kind: Schema.Literal('limit'), revision: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)), agents: Schema.Array(agentSchema) }),
])

export const agentRemoveResultSchema = Schema.Struct({
  kind: Schema.Literals(['applied', 'built-in', 'missing']),
  revision: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  agents: Schema.Array(agentSchema),
})

/** The Session a dispatch just opened, as the client reports it back to the registry. */
export const agentThreadInputSchema = Schema.Struct({
  sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SESSION_CHARS)),
  title: Schema.String.check(Schema.isMaxLength(200)),
})

export const agentPresetRowSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  broken: Schema.optional(Schema.String),
})

/** The Host's tools grouped by MCP server, owning plugin or DSH, each with the first sentence of its description. */
export const toolCatalogSchema = Schema.Struct({
  groups: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      kind: toolGroupKindSchema,
      label: Schema.String,
      tools: Schema.Array(Schema.Struct({ name: Schema.String, summary: Schema.String })),
    }),
  ),
})

export const toolAccessEditSchema = Schema.Struct({
  target: Schema.Struct({ kind: Schema.Literals(['tool', 'group']), key: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240)) }),
  /** The new entry; null (or an entry with no field) removes it, so the tool or group falls back to its group or the default. */
  entry: Schema.NullOr(toolAccessEntrySchema),
})

export const agentUpdateResultSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('applied'), revision: Schema.Number, agent: agentSchema }),
  Schema.Struct({ kind: Schema.Literal('missing'), revision: Schema.Number }),
])

export const projectDefaultsSchema = Schema.Struct({ projects: Schema.Array(projectDefaultSchema) })

export const projectDefaultResultSchema = Schema.Struct({
  kind: Schema.Literals(['applied', 'missing-agent']),
  projects: Schema.Array(projectDefaultSchema),
})

export const threadOverrideResultSchema = Schema.Struct({ kind: Schema.Literals(['applied', 'missing-agent']), view: threadAccessViewSchema })

export type AgentSnapshotView = typeof agentSnapshotSchema.Type
export type ToolCatalogView = typeof toolCatalogSchema.Type
export type ToolAccessEditInput = typeof toolAccessEditSchema.Type
export type AgentSaveResultView = typeof agentSaveResultSchema.Type
export type AgentRemoveResultView = typeof agentRemoveResultSchema.Type
export type AgentPresetRow = typeof agentPresetRowSchema.Type

/** The shared agent registry: identity, instructions, model route and preset, owned by the Host. */
export const agentsApi = defineApi({
  id: 'agents',
  version: 1,
  owner: '@dshfiles/agents',
  methods: {
    list: method({
      input: Schema.Void,
      output: agentSnapshotSchema,
      description: 'Every configured agent with its handle, instructions, model route, preset and usage. Read-only.',
      tool: { name: 'agents_list', readOnly: true },
    }),
    get: method({
      input: Schema.Struct({ handle: handleSchema }),
      output: Schema.Struct({ agent: Schema.NullOr(agentSchema) }),
      description: 'One agent by `@handle`, or null when no agent has that handle. Read-only.',
      tool: { name: 'agents_get', readOnly: true },
    }),
    presets: method({
      input: Schema.Void,
      output: Schema.Struct({ presets: Schema.Array(agentPresetRowSchema) }),
      description: 'The Agent presets this Host can start a thread with, for an agent whose preset decides its tools. Not an agent tool.',
    }),
    save: method({
      input: Schema.Struct({ agent: agentDraftSchema }),
      output: agentSaveResultSchema,
      description: `Create or update one agent. ${writeNote}`,
      tool: { name: 'agents_save', readOnly: false },
    }),
    remove: method({
      input: Schema.Struct({ handle: handleSchema, confirm: Schema.Literal(true) }),
      output: agentRemoveResultSchema,
      description: `Remove one agent. ${destructiveNote}`,
      tool: { name: 'agents_remove', readOnly: false },
    }),
    recordUse: method({
      input: Schema.Struct({ handle: handleSchema, thread: Schema.optional(agentThreadInputSchema) }),
      output: agentSnapshotSchema,
      description:
        'Record a dispatch: bump last-used time and count, and keep the thread it opened so the panel can list it after a Host restart. Not an agent tool.',
    }),
    threads: method({
      input: Schema.Struct({ handle: handleSchema }),
      output: Schema.Struct({ threads: Schema.Array(agentThreadSchema) }),
      description: 'The threads one agent started, newest first, with their titles and start times. Read-only.',
      tool: { name: 'agents_threads', readOnly: true },
    }),
    threadAgent: method({
      input: Schema.Struct({ sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SESSION_CHARS)) }),
      output: Schema.Struct({ agent: Schema.NullOr(agentSchema) }),
      description:
        'The agent that started one thread, by Session id, or null for a thread no agent started. Read-only; a cross-plugin lookup, not an agent tool.',
    }),
    toolCatalog: method({
      input: Schema.Void,
      output: toolCatalogSchema,
      description:
        'Every tool this Host serves, grouped by MCP server (mcp:<server>), owning plugin (plugin:<package>) or DSH itself (native), with the first sentence of each description: the keys agents_tool_access_set takes. Read-only.',
      tool: { name: 'agents_tool_catalog', readOnly: true },
    }),
    toolAccess: method({
      input: Schema.Struct({ handle: handleSchema }),
      output: Schema.Struct({ handle: handleSchema, access: Schema.NullOr(toolAccessSchema) }),
      description:
        "One agent's tool access: sparse enabled/pinned entries per tool name and per group; every tool without an entry is enabled and deferred behind tool_search. Null when no agent has that handle. Read-only.",
      tool: { name: 'agents_tool_access_get', readOnly: true },
    }),
    setToolAccess: method({
      input: Schema.Struct({
        handle: handleSchema,
        edits: Schema.Array(toolAccessEditSchema).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_TOOL_EDITS)),
      }),
      output: agentUpdateResultSchema,
      description: `Enable, disable, pin or unpin tools or whole groups for one agent; a tool entry beats its group entry. Threads started afterwards get it (a running thread keeps its tools; override it with agents_thread_override_set). Reversible: an edit with entry null removes that entry. ${writeNote}`,
      tool: { name: 'agents_tool_access_set', readOnly: false },
    }),
    setSubagents: method({
      input: Schema.Struct({ handle: handleSchema, subagents: agentSubagentsSchema }),
      output: agentUpdateResultSchema,
      description: `Which agents this agent's subagents may run as ('any' or a list of handles) and the default one (null: the parent thread's agent). Reversible by setting the previous value. ${writeNote}`,
      tool: { name: 'agents_subagents_set', readOnly: false },
    }),
    projectDefaults: method({
      input: Schema.Void,
      output: projectDefaultsSchema,
      description:
        'The default agent of each DSH project (by project workspace id). A thread no agent started, in that project, gets it; projects without one use @dsh. Read-only.',
      tool: { name: 'agents_project_defaults', readOnly: true },
    }),
    setProjectDefault: method({
      input: Schema.Struct({ projectId: projectIdSchema, handle: Schema.NullOr(handleSchema) }),
      output: projectDefaultResultSchema,
      description: `Set a DSH project's default agent, or clear it with handle null (threads then use @dsh). Threads started afterwards get it; running threads keep theirs. ${writeNote}`,
      tool: { name: 'agents_project_default_set', readOnly: false },
    }),
    threadAccess: method({
      input: Schema.Struct({ sessionId: sessionIdSchema }),
      output: threadAccessViewSchema,
      description:
        "One thread's agent, how it was decided (explicit, inherited from a subagent's parent, the project default or the @dsh fallback), its override and the tool policy that results. recorded: false is a preview for a thread whose agent is not decided yet. Read-only.",
      tool: { name: 'agents_thread_access', readOnly: true },
    }),
    setThreadOverride: method({
      input: Schema.Struct({ sessionId: sessionIdSchema, override: threadToolOverrideRequestSchema }),
      output: threadOverrideResultSchema,
      description: `Override one thread's tools with another agent's tools ({ kind: 'agent', handle }) or every tool ({ kind: 'all' }); null clears it. It applies from that thread's next model request, which loses its prompt cache once. ${writeNote}`,
      tool: { name: 'agents_thread_override_set', readOnly: false },
    }),
    recordThreadAgent: method({
      input: Schema.Struct({ sessionId: sessionIdSchema, handle: handleSchema }),
      output: Schema.Struct({ view: Schema.NullOr(threadAccessViewSchema) }),
      description:
        "Record a thread's agent explicitly (a subagent started with an agent, a mention) before or after it attaches; null when no agent has that handle. A cross-plugin write, not an agent tool.",
    }),
    threadHandles: method({
      input: Schema.Void,
      output: Schema.Struct({
        threads: Schema.Array(
          Schema.Struct({ sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SESSION_CHARS)), handle: handleSchema }),
        ),
      }),
      description:
        'Every remembered thread a configured agent started, with its handle, so thread lists can name the agent. Read-only; agents_threads covers the agent tool.',
    }),
  },
})
