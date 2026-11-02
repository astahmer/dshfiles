import { defineApi } from '@dshfiles/dshx/api'
import { Effect, Schema } from 'effect'
import { method } from './api-schema.js'

const sessionId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const text = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(100_000))
const modelSelection = Schema.Struct({
  provider: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(400)),
  reasoningEffort: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
})
const instructionKey = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(120),
  Schema.isPattern(/^[A-Za-z0-9@._:/-]+$/, { message: 'Use a stable key such as "@acme/plugin:style".' }),
)

const threadRow = Schema.Struct({
  sessionId: Schema.String,
  title: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  projectId: Schema.optional(Schema.String),
  projectTitle: Schema.optional(Schema.String),
  running: Schema.Boolean,
  updatedAt: Schema.Number,
})

const transcriptEntry = Schema.Struct({ seq: Schema.Number.check(Schema.isInt()), role: Schema.Literals(['user', 'assistant']), text: Schema.String })

const instructionEntries = Schema.Struct({ entries: Schema.Array(Schema.Struct({ key: Schema.String, text: Schema.String })) })

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
      input: Schema.Struct({
        query: Schema.optional(Schema.Trim.check(Schema.isMaxLength(200))),
        projectId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
        includeArchived: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
        limit: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200)).pipe(
          Schema.withDecodingDefault(Effect.succeed(50)),
        ),
      }),
      output: Schema.Struct({
        threads: Schema.Array(threadRow).check(Schema.isMaxLength(200)),
        total: Schema.Number.check(Schema.isInt()),
        truncated: Schema.Boolean,
      }),
      readOnly: true,
    }),
    messages: method({
      description: "A thread's most recent user and assistant messages, oldest first, each clipped to 8,000 characters.",
      input: Schema.Struct({
        sessionId,
        limit: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)).pipe(
          Schema.withDecodingDefault(Effect.succeed(20)),
        ),
      }),
      output: Schema.Struct({
        sessionId: Schema.String,
        running: Schema.Boolean,
        entries: Schema.Array(transcriptEntry).check(Schema.isMaxLength(100)),
        truncated: Schema.Boolean,
      }),
      readOnly: true,
    }),
    create: method({
      description: 'Start a thread in a project (projectId) or a directory (cwd), optionally with an agent preset, a title, a model and a first prompt.',
      input: Schema.Struct({
        projectId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
        cwd: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096))),
        agentPreset: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
        title: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
        model: Schema.optional(modelSelection),
        prompt: Schema.optional(text),
      }).check(Schema.makeFilter(input => (input.projectId === undefined || input.cwd === undefined ? true : 'Name a project or a directory, not both.'))),
      output: Schema.Struct({ sessionId: Schema.String }),
    }),
    prompt: method({
      description: 'Send a user prompt: queue it for the next turn, or steer the running turn.',
      input: Schema.Struct({
        sessionId,
        text,
        mode: Schema.Literals(['queue', 'steer']).pipe(Schema.withDecodingDefault(Effect.succeed('queue'))),
      }),
      output: Schema.Struct({ accepted: Schema.Literal(true) }),
    }),
    command: method({
      description: 'Run a slash command line in a thread, as typed in its composer (e.g. "/compact").',
      input: Schema.Struct({ sessionId, line: Schema.Trim.check(Schema.isStartingWith('/'), Schema.isMaxLength(10_000)) }),
      output: Schema.Struct({ kind: Schema.Literals(['success', 'error']), text: Schema.optional(Schema.String) }),
    }),
    message: method({
      description:
        'Add a message to the thread on behalf of a plugin: it reaches the model like a user message but is recorded with the plugin as its source. next-turn waits for the next turn, next-step joins the running one; wake starts a turn on an idle thread.',
      input: Schema.Struct({
        sessionId,
        text,
        target: Schema.Literals(['next-turn', 'next-step']).pipe(Schema.withDecodingDefault(Effect.succeed('next-turn'))),
        wake: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
      }),
      output: Schema.Struct({ messageId: Schema.String }),
    }),
    compact: method({
      description: "Compact the thread's history now (the /compact command).",
      input: Schema.Struct({ sessionId }),
      output: Schema.Struct({ kind: Schema.Literals(['success', 'error']), text: Schema.optional(Schema.String) }),
    }),
    interrupt: method({
      description: 'Stop the running turn; queued prompts stay queued.',
      input: Schema.Struct({ sessionId }),
      output: Schema.Struct({ interrupted: Schema.Literal(true) }),
    }),
    wait: method({
      description: 'Wait until the thread is idle with nothing queued, or until timeoutMs passes.',
      input: Schema.Struct({
        sessionId,
        timeoutMs: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(600_000)).pipe(
          Schema.withDecodingDefault(Effect.succeed(60_000)),
        ),
      }),
      output: Schema.Struct({ status: Schema.Literals(['idle', 'running']) }),
      readOnly: true,
    }),
    selectModel: method({
      description: "Switch the thread's model; the next request uses it.",
      input: Schema.Struct({ sessionId, ...modelSelection.fields }),
      output: modelSelection,
    }),
    selectAgent: method({
      description: 'Switch the agent preset the thread runs.',
      input: Schema.Struct({ sessionId, agentPreset: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)) }),
      output: Schema.Struct({ agentPreset: Schema.String }),
    }),
    instructions: method({
      description: 'The keyed instructions added to this thread’s prompt.',
      input: Schema.Struct({ sessionId }),
      output: instructionEntries,
      readOnly: true,
    }),
    setInstruction: method({
      description:
        'Add, replace (same key) or remove (text null) one instruction that every later request of this thread carries in its prompt; kept across Host restarts.',
      input: Schema.Struct({ sessionId, key: instructionKey, text: Schema.NullOr(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(8_000))) }),
      output: instructionEntries,
    }),
    generate: method({
      description:
        'One model call outside any thread (no tools, nothing recorded). With jsonSchema the reply is one JSON value matching it, returned as value. The model defaults to the Host default.',
      input: Schema.Struct({
        prompt: text,
        system: Schema.optional(Schema.String.check(Schema.isMaxLength(100_000))),
        model: Schema.optional(modelSelection),
        sessionId: Schema.optional(sessionId),
        jsonSchema: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
        maxTokens: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(64_000))),
      }),
      output: Schema.Struct({ text: Schema.String, value: Schema.optional(Schema.Json), provider: Schema.String, model: Schema.String }),
    }),
  },
})
