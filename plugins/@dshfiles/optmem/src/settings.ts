import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

const effort = Schema.union([
  Schema.const('').description('Adapter default'),
  Schema.const('off').description('off (no reasoning, where the route offers it)'),
  Schema.const('low').description('low'),
  Schema.const('medium').description('medium'),
  Schema.const('high').description('high'),
]).default('')

export const optmemSettings = defineSettings({
  namespace: 'dshfiles-optmem',
  schema: Schema.object({
    enabled: Schema.boolean().default(true).description('Capture sessions, register memory tools and inject the compact memory view.'),
    mode: Schema.union([
      Schema.const('compat').description('Compatibility: DSH keeps its own context'),
      Schema.const('full').description('Full: fresh context per turn (needs @dshfiles/request-messages)'),
    ])
      .default('compat')
      .description(
        'Full mode needs the @dshfiles/request-messages bundle (agent/request-messages); without it full mode is reported unsupported and the plugin runs in compatibility mode.',
      ),
    injectUpperBytes: Schema.natural().min(1_024).max(65_536).default(8_192).description('Compact view merge threshold, and the injected memory budget.'),
    injectLowerBytes: Schema.natural().min(512).max(65_536).default(4_096).description('Compact view size a merge batch shrinks to.'),
    injectRefreshBytes: Schema.natural()
      .min(0)
      .max(65_536)
      .default(1_024)
      .description(
        'Compatibility mode: the injected view is re-emitted only once it grew by this many bytes, or when a merge rewrote it (each re-emit adds a context message to the session).',
      ),
    viewUpperBytes: Schema.natural().min(4_096).max(1_048_576).default(128_000).description('Main view merge threshold.'),
    viewLowerBytes: Schema.natural().min(2_048).max(1_048_576).default(64_000).description('Main view size a merge batch shrinks to.'),
    maxNodeBytes: Schema.natural().min(128).max(4_096).default(512).description('Byte budget of one memory node (verbatim event or summary).'),
    summarizerProvider: Schema.string()
      .default('')
      .description('Override route provider for every summary. Empty uses the provider of the thread being summarized.'),
    summarizerModel: Schema.string()
      .default('')
      .description("Override: one model for every summary (with summarizerProvider). Empty uses the thread's provider with its cheap model from cheapModels."),
    summarizerEffort: effort.description('Reasoning effort of override summary calls.'),
    cheapModels: Schema.array(
      Schema.object({
        kind: Schema.string().required().description('Provider kind from AI Accounts (codex, claude, opencode-go, commandcode), or an exact provider id.'),
        models: Schema.array(Schema.string()).default([]).description('Cheap models in preference order; a trailing * takes the newest matching id.'),
        effort,
      }),
    )
      .default([
        { kind: 'codex', models: ['gpt-6-luna'], effort: 'low' },
        { kind: 'claude', models: ['claude-haiku-*'], effort: 'low' },
        { kind: 'opencode-go', models: ['deepseek-v4.1-flash', 'deepseek-v4-flash', 'glm-5.3-flash'], effort: 'off' },
        { kind: 'commandcode', models: ['deepseek-v4.1-flash', 'deepseek-v4-flash', 'gpt-6-luna'], effort: '' },
        { kind: 'deepseek', models: ['deepseek-flash'], effort: '' },
      ])
      .description(
        "Default routing: summaries use the thread's own provider with the first model listed here that the provider offers. A provider with no entry or no offered model goes to summarizerFallbacks.",
      ),
    summarizerFallbacks: Schema.array(
      Schema.object({
        provider: Schema.string().default('').description("Provider id; empty means the thread's provider."),
        model: Schema.string().required(),
        effort,
      }),
    )
      .default([])
      .description(
        "Routes tried in order when the override or cheap model is not offered. With none left, summaries wait and retry; the thread's own model is never used.",
      ),
    summarizerPaused: Schema.boolean()
      .default(false)
      .description('Pause summarizing: no summary call is made; oversized events stay pending and are summarized once resumed.'),
    summarizerConcurrency: Schema.natural().min(1).max(16).default(2).description('Summaries in flight at once.'),
    summarizerTimeoutMs: Schema.natural().min(1_000).max(600_000).default(60_000).description('Timeout of one summary call; failures retry with backoff.'),
    summaryCallsPerMinute: Schema.natural()
      .min(0)
      .max(6_000)
      .default(60)
      .description('Model calls allowed per rolling minute across every stream, which caps catch-up cost. 0 means unlimited.'),
    leafFallbackAfterAttempts: Schema.natural()
      .min(1)
      .max(20)
      .default(3)
      .description(
        "After this many failed summary attempts a node is rebuilt from clipped head+tail text and marked unsummarized, so one bad position cannot freeze a stream's view. A non-retryable failure falls back at once.",
      ),
    catchUpIntervalMs: Schema.natural()
      .min(0)
      .max(600_000)
      .default(15_000)
      .description('Background recovery sweep interval. Each sweep queues at most catchUpBatchPerStream per stream. 0 disables automatic backlog recovery.'),
    catchUpBatchPerStream: Schema.natural()
      .min(0)
      .max(5_000)
      .default(50)
      .description('Leaves one stream may add per recovery sweep; also bounds how fast a backlog drains.'),
    barrierMs: Schema.natural().min(0).max(60_000).default(5_000).description('Longest wait for pending summaries before a snapshot renders them raw.'),
    toolResultCap: Schema.natural()
      .min(1_024)
      .max(262_144)
      .default(16_384)
      .description('Bytes of one tool result kept in memory, head and tail, with a truncation marker.'),
    excludedTools: Schema.array(Schema.string()).default([]).description('Tool names whose calls and results are stored as an exclusion marker only.'),
    excludedPaths: Schema.array(Schema.string())
      .default(['**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/id_rsa*', '**/.ssh/**'])
      .description('Path globs; a tool call that names a matching path is stored as an exclusion marker, with its result.'),
    allowAllProjects: Schema.boolean()
      .default(false)
      .description('Let memory tools read every project (scope all-projects). Off keeps retrieval inside the calling project.'),
    captureSubagents: Schema.boolean().default(true).description('Capture subagent sessions, linked to their parent conversation.'),
  }),
  applies: 'live',
})

export type OptmemSettings = SettingsValue<typeof optmemSettings.schema>
