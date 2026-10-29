import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const sessionId = z.string().min(1).max(256)
const text = z.string().trim().min(1).max(100_000)
const modelSelection = z
  .object({ provider: z.string().min(1).max(200), model: z.string().min(1).max(400), reasoningEffort: z.string().min(1).max(64).optional() })
  .strict()
const instructionKey = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9@._:/-]+$/, 'Use a stable key such as "@acme/plugin:style".')

const threadRow = z
  .object({
    sessionId: z.string(),
    title: z.string().optional(),
    cwd: z.string().optional(),
    projectId: z.string().optional(),
    projectTitle: z.string().optional(),
    running: z.boolean(),
    updatedAt: z.number(),
  })
  .strict()

const transcriptEntry = z.object({ seq: z.number().int(), role: z.enum(['user', 'assistant']), text: z.string() }).strict()

/**
 * Drive threads from another plugin or a browser: create one, prompt it, run its commands, add a message on its
 * behalf, compact, interrupt, wait, switch model or agent, and keep keyed instructions in its prompt. Every method
 * runs the same native path the Chat UI uses; agents are not offered these as tools (thread-sidebar's thread tools
 * cover what the agent may do to other threads).
 */
export const sessionsApi = defineApi({
  id: 'sessions',
  version: 1,
  owner: '@dshfiles/session-controller',
  methods: {
    list: method({
      description:
        'List visible threads newest first, with title, directory, project and whether a turn is running. query matches title, directory or project title.',
      input: z
        .object({
          query: z.string().trim().max(200).optional(),
          projectId: z.string().min(1).max(256).optional(),
          includeArchived: z.boolean().default(false),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .strict(),
      output: z.object({ threads: z.array(threadRow).max(200), total: z.number().int(), truncated: z.boolean() }).strict(),
      readOnly: true,
    }),
    messages: method({
      description: "A thread's most recent user and assistant messages, oldest first, each clipped to 8,000 characters.",
      input: z.object({ sessionId, limit: z.number().int().min(1).max(100).default(20) }).strict(),
      output: z.object({ sessionId: z.string(), running: z.boolean(), entries: z.array(transcriptEntry).max(100), truncated: z.boolean() }).strict(),
      readOnly: true,
    }),
    create: method({
      description: 'Start a thread in a project (projectId) or a directory (cwd), optionally with an agent preset, a title, a model and a first prompt.',
      input: z
        .object({
          projectId: z.string().min(1).max(256).optional(),
          cwd: z.string().min(1).max(4096).optional(),
          agentPreset: z.string().min(1).max(200).optional(),
          title: z.string().trim().min(1).max(200).optional(),
          model: modelSelection.optional(),
          prompt: text.optional(),
        })
        .strict()
        .refine(input => input.projectId === undefined || input.cwd === undefined, 'Name a project or a directory, not both.'),
      output: z.object({ sessionId: z.string() }).strict(),
    }),
    prompt: method({
      description: 'Send a user prompt: queue it for the next turn, or steer the running turn.',
      input: z.object({ sessionId, text, mode: z.enum(['queue', 'steer']).default('queue') }).strict(),
      output: z.object({ accepted: z.literal(true) }).strict(),
    }),
    command: method({
      description: 'Run a slash command line in a thread, as typed in its composer (e.g. "/compact").',
      input: z.object({ sessionId, line: z.string().trim().startsWith('/').max(10_000) }).strict(),
      output: z.object({ kind: z.enum(['success', 'error']), text: z.string().optional() }).strict(),
    }),
    message: method({
      description:
        'Add a message to the thread on behalf of a plugin: it reaches the model like a user message but is recorded with the plugin as its source. next-turn waits for the next turn, next-step joins the running one; wake starts a turn on an idle thread.',
      input: z.object({ sessionId, text, target: z.enum(['next-turn', 'next-step']).default('next-turn'), wake: z.boolean().default(false) }).strict(),
      output: z.object({ messageId: z.string() }).strict(),
    }),
    compact: method({
      description: "Compact the thread's history now (the /compact command).",
      input: z.object({ sessionId }).strict(),
      output: z.object({ kind: z.enum(['success', 'error']), text: z.string().optional() }).strict(),
    }),
    interrupt: method({
      description: 'Stop the running turn; queued prompts stay queued.',
      input: z.object({ sessionId }).strict(),
      output: z.object({ interrupted: z.literal(true) }).strict(),
    }),
    wait: method({
      description: 'Wait until the thread is idle with nothing queued, or until timeoutMs passes.',
      input: z.object({ sessionId, timeoutMs: z.number().int().min(0).max(600_000).default(60_000) }).strict(),
      output: z.object({ status: z.enum(['idle', 'running']) }).strict(),
      readOnly: true,
    }),
    selectModel: method({
      description: "Switch the thread's model; the next request uses it.",
      input: z.object({ sessionId }).extend(modelSelection.shape).strict(),
      output: modelSelection,
    }),
    selectAgent: method({
      description: 'Switch the agent preset the thread runs.',
      input: z.object({ sessionId, agentPreset: z.string().min(1).max(200) }).strict(),
      output: z.object({ agentPreset: z.string() }).strict(),
    }),
    instructions: method({
      description: 'The keyed instructions added to this thread’s prompt.',
      input: z.object({ sessionId }).strict(),
      output: z.object({ entries: z.array(z.object({ key: z.string(), text: z.string() }).strict()) }).strict(),
      readOnly: true,
    }),
    setInstruction: method({
      description:
        'Add, replace (same key) or remove (text null) one instruction that every later request of this thread carries in its prompt; kept across Host restarts.',
      input: z.object({ sessionId, key: instructionKey, text: z.string().trim().min(1).max(8_000).nullable() }).strict(),
      output: z.object({ entries: z.array(z.object({ key: z.string(), text: z.string() }).strict()) }).strict(),
    }),
    generate: method({
      description:
        'One model call outside any thread (no tools, nothing recorded). With jsonSchema the reply is one JSON value matching it, returned as value. The model defaults to the Host default.',
      input: z
        .object({
          prompt: text,
          system: z.string().max(100_000).optional(),
          model: modelSelection.optional(),
          sessionId: sessionId.optional(),
          jsonSchema: z.record(z.string(), z.json()).optional(),
          maxTokens: z.number().int().min(1).max(64_000).optional(),
        })
        .strict(),
      output: z.object({ text: z.string(), value: z.json().optional(), provider: z.string(), model: z.string() }).strict(),
    }),
  },
})
