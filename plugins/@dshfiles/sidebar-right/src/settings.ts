import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const sidebarRightSettings = defineSettings({
  namespace: 'dshfiles-sidebar-right',
  schema: Schema.object({
    residentThreads: Schema.number()
      .min(0)
      .max(50)
      .step(1)
      .default(4)
      .description(
        'How many other threads keep their side-panel tabs loaded (0 keeps every visited thread).',
      ),
  }),
})
