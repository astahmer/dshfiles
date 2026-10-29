import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const previewSettings = defineSettings({
  namespace: 'dshfiles-preview',
  schema: Schema.object({
    allowedHosts: Schema.array(Schema.string())
      .default(['localhost', '127.0.0.1', '::1', '*.localhost'])
      .description('Hosts the preview browser may navigate to. A leading `*.` matches any subdomain. Subresources a page loads are not filtered.'),
    allowAnyHost: Schema.boolean().default(false).description('Let the preview browser navigate to any http(s) host, not only the allowed ones.'),
    allowEvaluate: Schema.boolean().default(false).description('Offer preview_evaluate, which runs agent-written JavaScript inside the preview page.'),
    chromiumPath: Schema.string()
      .default('')
      .description('Chrome or Chromium executable for the preview browser. Empty uses the Playwright headless shell installed for playwright-core.'),
    idleMinutes: Schema.natural()
      .min(1)
      .max(240)
      .default(15)
      .description('Close a thread’s preview pages after this many minutes without a preview tool call.'),
    maxPagesPerThread: Schema.natural().min(1).max(16).default(4).description('Most preview pages one thread may keep open at once.'),
  }),
  applies: 'live',
})

export type PreviewSettings = ReturnType<typeof previewSettings.schema>
