import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const sessionWarmingSettings = defineSettings({
  namespace: 'dshfiles-session-warming',
  schema: Schema.object({
    enabled: Schema.boolean()
      .default(false)
      .description('Keep an idle thread’s provider prompt cache alive by re-sending its last request for one output token. Each warm-up is a billed request.'),
    intervalMinutes: Schema.natural()
      .min(1)
      .max(55)
      .default(4)
      .description('Minutes between warm-ups; keep it under the provider’s cache lifetime (five minutes for most).'),
    maxWarmupsPerIdle: Schema.natural().min(1).max(20).default(3).description('Warm-ups one thread gets between two prompts; the cache then expires.'),
    maxWarmupsPerHour: Schema.natural().min(1).max(600).default(30).description('Warm-ups across every thread in one rolling hour.'),
    providers: Schema.array(Schema.string()).default([]).description('Provider routes to warm, such as `anthropic`; empty warms every provider.'),
  }),
})
