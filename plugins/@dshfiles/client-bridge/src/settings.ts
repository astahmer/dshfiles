import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const clientBridgeSettings = defineSettings({
  namespace: 'dshfiles-client-bridge',
  schema: Schema.object({
    enabled: Schema.boolean()
      .default(true)
      .description('Let Agents run client tools in your DSH browser windows (open Settings at a section, open a tab). Off refuses every call.'),
    notify: Schema.boolean().default(true).description('Show a notice in the window each time an Agent runs a tool that changes the page.'),
  }),
  applies: 'live',
})

export type ClientBridgeSettings = ReturnType<typeof clientBridgeSettings.schema>
