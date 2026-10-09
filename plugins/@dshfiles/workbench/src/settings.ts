import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const workbenchSettings = defineSettings({
  namespace: 'dshfiles-workbench',
  schema: Schema.object({
    headerToggle: Schema.boolean().default(true).description('Show a button in the conversation header that toggles the workbench in the right side panel.'),
  }),
  applies: 'live',
})
