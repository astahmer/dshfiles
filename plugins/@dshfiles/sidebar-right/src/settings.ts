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
        'Threads besides the one on screen whose side-panel tabs stay loaded: kept-mounted bodies (editor, Workbench), resource pins and their live Session. Older threads reload them when shown again. 0 keeps every visited thread loaded.',
      ),
  }),
})
