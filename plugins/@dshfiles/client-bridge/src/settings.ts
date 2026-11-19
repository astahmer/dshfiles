import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const clientBridgeSettings = defineSettings({
  namespace: 'dshfiles-client-bridge',
  schema: Schema.object({
    enabled: Schema.boolean()
      .default(true)
      .description(
        'Let Agents act in your DSH browser windows (open a file in the editor, a panel, Settings, a tab, a palette command). Off refuses every call.',
      ),
    notify: Schema.boolean().default(true).description('Show a notice in the window each time an Agent runs a tool that changes the page.'),
  }),
  applies: 'live',
})

export type ClientBridgeSettings = ReturnType<typeof clientBridgeSettings.schema>
