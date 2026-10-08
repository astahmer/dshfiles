import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const secretCatalogSettings = defineSettings({
  namespace: 'secret-catalog',
  schema: Schema.object({
    defaultScope: Schema.union(['all', 'project', 'global', 'local'])
      .default('all')
      .description('Scope filter selected when the Secret Catalog opens.'),
    defaultEnvironment: Schema.string()
      .pattern(/^[A-Za-z0-9_-]+$/)
      .default('prod')
      .description('Environment prefilled when adding a secret.'),
    revealSeconds: Schema.natural()
      .min(3)
      .max(300)
      .default(15)
      .description('Seconds a revealed value stays visible before it is hidden again.'),
    hideOnBlur: Schema.boolean().default(true).description('Hide a revealed value when the window loses focus or the page is hidden.'),
    noticeSeconds: Schema.natural()
      .max(60)
      .default(4)
      .description('Seconds a success notice stays visible. 0 keeps it until dismissed.'),
  }),
  applies: 'live',
})
