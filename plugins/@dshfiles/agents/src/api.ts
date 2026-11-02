import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'
import { AGENT_HANDLE_PATTERN, agentDraftSchema, agentSchema, agentThreadSchema, MAX_SESSION_CHARS } from './agent.js'

const handleSchema = Schema.String.check(Schema.isPattern(AGENT_HANDLE_PATTERN))
const writeNote = 'May run only when the user asked for that change.'
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

export type AgentSnapshotView = typeof agentSnapshotSchema.Type
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
  },
})
