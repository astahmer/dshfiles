import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const editorSettings = defineSettings({
  namespace: 'dshfiles-editor',
  schema: Schema.object({
    editorPlacement: Schema.union([
      Schema.const('workbench').description('Workbench (dockable main-area panel)'),
      Schema.const('right-panel').description('Right panel tab'),
    ])
      .default('workbench')
      .description('Where files opened from other panels show up.'),
    openFileLinks: Schema.boolean()
      .default(true)
      .description('Open file links from threads (tool calls, references) in the editor instead of the read-only preview.'),
  }),
  applies: 'live',
})
