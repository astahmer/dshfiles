import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const tracesSettings = defineSettings({
  namespace: 'dshfiles-traces',
  schema: Schema.object({
    mode: Schema.union([
      Schema.const('plugin').description('This plugin: the built-in receiver owns the OTLP port and this panel shows what it stores'),
      Schema.const('external').description('External viewer: the receiver stays off; another tool (dsh-traces, a collector) owns the port'),
      Schema.const('both').description('Both: the built-in receiver stores and also forwards every request to the external viewer'),
    ])
      .default('plugin')
      .description('Where OTLP telemetry goes. Exporters send to OTEL_EXPORTER_OTLP_ENDPOINT, so in plugin or both mode set it to http://<host>:<port> below.'),
    host: Schema.string().default('127.0.0.1').description('Address the receiver listens on. Loopback by default.'),
    allowNonLoopback: Schema.boolean()
      .default(false)
      .description('Allow a non-loopback listen address. Anything on that network can then post telemetry here; leave off unless you mean it.'),
    port: Schema.natural().max(65_535).default(4318).description('OTLP/HTTP port. 4318 is the standard one; 0 picks any free port (the panel shows which).'),
    forwardUrl: Schema.string()
      .default('')
      .description('Both mode: the external viewer’s OTLP/HTTP base URL, e.g. http://127.0.0.1:4319. /v1/traces, /v1/metrics and /v1/logs are appended.'),
    externalViewerUrl: Schema.string()
      .default('')
      .description('The external viewer’s web page (e.g. http://127.0.0.1:8000 for otel-desktop-viewer), linked from the panel in external and both modes.'),
    redactGenAiContent: Schema.boolean()
      .default(true)
      .description(
        'Store GenAI message, prompt and tool-payload attributes (gen_ai.input.messages, gen_ai.tool.call.arguments, …) as their size only. Exporters send them only when content capture is opted into.',
      ),
    retentionHours: Schema.natural().min(1).max(720).default(72).description('Drop stored telemetry older than this many hours.'),
    retentionSpans: Schema.natural().min(1_000).max(1_000_000).default(100_000).description('Keep at most this many spans; the oldest whole traces go first.'),
  }),
  applies: 'live',
})

export type TracesSettings = SettingsValue<typeof tracesSettings.schema>
