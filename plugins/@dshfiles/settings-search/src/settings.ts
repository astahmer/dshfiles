import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const settingsSearchSettings = defineSettings({
  namespace: 'settings-search',
  schema: Schema.object({
    navigationSearch: Schema.boolean().default(true).description('Show a compact search field above the Settings navigation.'),
    focusOnOpen: Schema.boolean().default(true).description('Focus the search field each time Settings opens.'),
    maxResults: Schema.natural().min(5).max(100).default(30).description('Most results listed under the navigation search field.'),
  }),
  applies: 'live',
})
