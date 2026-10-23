import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const agentTelemetrySettings = defineSettings({
  namespace: 'dshfiles-agent-telemetry',
  schema: Schema.object({
    captureContent: Schema.union([
      Schema.const('environment').description('Follow OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT (SPAN_ONLY or SPAN_AND_EVENT turn it on)'),
      Schema.const('off').description('Off: spans carry metadata only'),
      Schema.const('on').description('On: prompts, completions, tool arguments and results go on spans, each cut to 1,024 characters'),
    ])
      .default('environment')
      .description(
        'Put message content on agent spans. Off by default: no prompt, reply, tool argument or tool result leaves the Host. The traces viewer still stores content as its size while redactGenAiContent is on.',
      ),
  }),
  applies: 'live',
})

export type AgentTelemetrySettings = SettingsValue<typeof agentTelemetrySettings.schema>
