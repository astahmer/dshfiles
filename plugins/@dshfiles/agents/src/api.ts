import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { AGENT_HANDLE_PATTERN, agentDraftSchema, agentSchema, agentThreadSchema, MAX_SESSION_CHARS } from './agent.js'

const handleSchema = z.string().regex(AGENT_HANDLE_PATTERN)
const writeNote = 'May run only when the user asked for that change.'
const destructiveNote = 'Destructive: requires `confirm: true`, which is never implied by a bare request.'

export const agentSnapshotSchema = z
  .object({
    revision: z.number().int().positive(),
    agents: z.array(agentSchema),
  })
  .strict()

export const agentSaveResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('applied'), revision: z.number().int().positive(), agents: z.array(agentSchema), agent: agentSchema }).strict(),
  z.object({ kind: z.literal('limit'), revision: z.number().int().positive(), agents: z.array(agentSchema) }).strict(),
])

export const agentRemoveResultSchema = z
  .object({
    kind: z.enum(['applied', 'built-in', 'missing']),
    revision: z.number().int().positive(),
    agents: z.array(agentSchema),
  })
  .strict()

/** The Session a dispatch just opened, as the client reports it back to the registry. */
export const agentThreadInputSchema = z
  .object({
    sessionId: z.string().min(1).max(MAX_SESSION_CHARS),
    title: z.string().max(200),
  })
  .strict()

export const agentPresetRowSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    description: z.string().optional(),
    broken: z.string().optional(),
  })
  .strict()

export type AgentSnapshotView = z.infer<typeof agentSnapshotSchema>
export type AgentSaveResultView = z.infer<typeof agentSaveResultSchema>
export type AgentRemoveResultView = z.infer<typeof agentRemoveResultSchema>
export type AgentPresetRow = z.infer<typeof agentPresetRowSchema>

/** The shared agent registry: identity, instructions, model route and preset, owned by the Host. */
export const agentsApi = defineApi({
  id: 'agents',
  version: 1,
  owner: '@dshfiles/agents',
  methods: {
    list: method({
      input: z.void(),
      output: agentSnapshotSchema,
      description: 'Every configured agent with its handle, instructions, model route, preset and usage. Read-only.',
      tool: { name: 'agents_list', readOnly: true },
    }),
    get: method({
      input: z.object({ handle: handleSchema }).strict(),
      output: z.object({ agent: agentSchema.nullable() }).strict(),
      description: 'One agent by `@handle`, or null when no agent has that handle. Read-only.',
      tool: { name: 'agents_get', readOnly: true },
    }),
    presets: method({
      input: z.void(),
      output: z.object({ presets: z.array(agentPresetRowSchema) }).strict(),
      description: 'The Agent presets this Host can start a thread with, for an agent whose preset decides its tools. Not an agent tool.',
    }),
    save: method({
      input: z.object({ agent: agentDraftSchema }).strict(),
      output: agentSaveResultSchema,
      description: `Create or update one agent. ${writeNote}`,
      tool: { name: 'agents_save', readOnly: false },
    }),
    remove: method({
      input: z.object({ handle: handleSchema, confirm: z.literal(true) }).strict(),
      output: agentRemoveResultSchema,
      description: `Remove one agent. ${destructiveNote}`,
      tool: { name: 'agents_remove', readOnly: false },
    }),
    recordUse: method({
      input: z.object({ handle: handleSchema, thread: agentThreadInputSchema.optional() }).strict(),
      output: agentSnapshotSchema,
      description:
        'Record a dispatch: bump last-used time and count, and keep the thread it opened so the panel can list it after a Host restart. Not an agent tool.',
    }),
    threads: method({
      input: z.object({ handle: handleSchema }).strict(),
      output: z.object({ threads: z.array(agentThreadSchema) }).strict(),
      description: 'The threads one agent started, newest first, with their titles and start times. Read-only.',
      tool: { name: 'agents_threads', readOnly: true },
    }),
    threadAgent: method({
      input: z.object({ sessionId: z.string().min(1).max(MAX_SESSION_CHARS) }).strict(),
      output: z.object({ agent: agentSchema.nullable() }).strict(),
      description:
        'The agent that started one thread, by Session id, or null for a thread no agent started. Read-only; a cross-plugin lookup, not an agent tool.',
    }),
  },
})
