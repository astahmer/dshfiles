import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const optmemSettings = defineSettings({
  namespace: 'dshfiles-optmem',
  schema: Schema.object({
    enabled: Schema.boolean().default(true).description('Capture sessions, register memory tools and inject the compact memory view.'),
    mode: Schema.union([
      Schema.const('compat').description('Compatibility: DSH keeps its own context'),
      Schema.const('full').description('Full: fresh context per turn (needs a fork capability)'),
    ])
      .default('compat')
      .description('Full mode is validated at startup and reported unsupported on stock DSH; the plugin then runs in compatibility mode.'),
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
    summarizerProvider: Schema.string().default('').description('LLM provider route for summaries; empty picks the first provider that serves the model.'),
    summarizerModel: Schema.string()
      .default('gpt-6-luna')
      .description('Model for summaries. When no provider serves it, nothing is summarized and memory_status says why.'),
    summarizerEffort: Schema.union([Schema.const('low'), Schema.const('medium'), Schema.const('high')])
      .default('low')
      .description('Reasoning effort of summary calls.'),
    summarizerConcurrency: Schema.natural().min(1).max(16).default(2).description('Summaries in flight at once.'),
    summarizerTimeoutMs: Schema.natural().min(1_000).max(600_000).default(60_000).description('Timeout of one summary call; failures retry with backoff.'),
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

export type OptmemSettings = ReturnType<typeof optmemSettings.schema>
