import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const readableFetchSettings = defineSettings({
  namespace: 'dshfiles-web-fetch-readable',
  schema: Schema.object({
    readable: Schema.boolean()
      .default(true)
      .description('Reduce an HTML page to its readable article (Mozilla Readability) before web_fetch converts it to markdown. Off returns the whole page.'),
    maxRedirects: Schema.number()
      .min(0)
      .max(20)
      .step(1)
      .default(8)
      .description('Redirect hops to follow, 0 to 20. Every hop, cross-origin included, is revalidated as a public address before it is requested.'),
    timeoutMs: Schema.number().min(1_000).max(120_000).step(1_000).default(30_000).description('Whole-fetch timeout in milliseconds, redirects included.'),
    maxResponseBytes: Schema.number()
      .min(10_000)
      .max(50_000_000)
      .default(5_000_000)
      .description('Bytes read from the final response; a larger declared length is refused, a longer stream is cut.'),
    maxBodyChars: Schema.number()
      .min(1_000)
      .max(1_000_000)
      .default(100_000)
      .description('Characters returned after decoding and extraction; web_fetch keeps its own output bound on top.'),
  }),
})

export type ReadableFetchSettings = SettingsValue<typeof readableFetchSettings.schema>
