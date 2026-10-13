import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

const effort = Schema.union([
  Schema.const('').description('Adapter default'),
  Schema.const('off').description('off (no reasoning, where the route offers it)'),
  Schema.const('low').description('low'),
  Schema.const('medium').description('medium'),
  Schema.const('high').description('high'),
])

export const memorySettings = defineSettings({
  namespace: 'dshfiles-memory',
  schema: Schema.object({
    enabled: Schema.boolean().default(true).description('Digest idle threads, add the start block to new threads and register the memory tools.'),
    crossProject: Schema.boolean()
      .default(true)
      .description('Let the start block and memory_search reach other projects. Off keeps memory inside the calling project.'),
    blockBytes: Schema.natural()
      .min(256)
      .max(8_192)
      .default(1_600)
      .description('Byte budget of the start block. It is frozen per thread and identical for every thread of a project until memory changes.'),
    blockStaleDays: Schema.natural()
      .min(0)
      .max(3_650)
      .default(90)
      .description('Threads never cited by an agent and older than this many days leave the start block; they stay searchable. 0 keeps them.'),
    idleMs: Schema.natural()
      .min(1_000)
      .max(3_600_000)
      .default(60_000)
      .description('How long a thread stays without a turn before its digest is built. A new turn cancels the wait.'),
    summarizerProvider: Schema.string()
      .default('')
      .description("Override provider for the few digests that need a model. Empty uses the thread's provider with its cheap model."),
    summarizerModel: Schema.string().default('').description('Override model for those digests (with summarizerProvider).'),
    summarizerEffort: effort.default('off').description('Reasoning effort of digest calls; off by default.'),
    cheapModels: Schema.array(
      Schema.object({
        kind: Schema.string().required().description('Provider kind from AI Accounts (codex, claude, opencode-go, commandcode), or an exact provider id.'),
        models: Schema.array(Schema.string()).default([]).description('Cheap models in preference order; a trailing * takes the newest matching id.'),
        effort: effort.default('off'),
      }),
    )
      .default([
        { kind: 'codex', models: ['gpt-6-luna'], effort: 'low' },
        { kind: 'claude', models: ['claude-haiku-*'], effort: 'low' },
        { kind: 'opencode-go', models: ['deepseek-v4.1-flash', 'deepseek-v4-flash', 'glm-5.3-flash'], effort: 'off' },
        { kind: 'commandcode', models: ['deepseek-v4.1-flash', 'deepseek-v4-flash', 'gpt-6-luna'], effort: '' },
        { kind: 'deepseek', models: ['deepseek-flash'], effort: '' },
      ])
      .description("Same routing as OptMem: a digest that needs a model uses the thread's provider with the first cheap model it offers."),
    jevEnabled: Schema.boolean()
      .default(false)
      .description(
        "Ask TypeSafe's Jev classifier which user messages carry a durable signal and whether a new thread likely needs memory. Needs TYPESAFE_API_KEY in the Host environment; any failure falls back to the heuristics.",
      ),
    jevThreshold: Schema.number().min(0).max(1).step(0.05).default(0.5).description('Jev probability above which a message counts as a signal.'),
    retentionDays: Schema.natural()
      .min(0)
      .max(3_650)
      .default(365)
      .description('Digests and the message index older than this many days are dropped. Notes stay until forgotten. 0 keeps everything.'),
  }),
  applies: 'live',
})

export type MemorySettings = SettingsValue<typeof memorySettings.schema>
