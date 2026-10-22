import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const braveSearchSettings = defineSettings({
  namespace: 'dshfiles-web-search-brave',
  schema: Schema.object({
    apiKey: Schema.string()
      .role('secret-ref')
      .default('secret:brave-api-key')
      .description(
        'Secret Catalog alias holding the Brave Search API key, written as secret:ALIAS or secret:ALIAS@env. The value never leaves the Host; an empty value falls back to BRAVE_API_KEY.',
      ),
    count: Schema.number()
      .min(1)
      .max(20)
      .step(1)
      .default(5)
      .description('Web results requested per search, 1 to 20. The tool keeps its own maxResults bound on top.'),
    safesearch: Schema.union([
      Schema.const('off').description('Off: no filtering.'),
      Schema.const('moderate').description('Moderate: filter explicit results (default).'),
      Schema.const('strict').description('Strict: filter more aggressively.'),
    ])
      .default('moderate')
      .description('Brave safesearch level for every search.'),
  }),
})

export type BraveSearchSettings = SettingsValue<typeof braveSearchSettings.schema>
