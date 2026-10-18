import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const workbenchSettings = defineSettings({
  namespace: 'dshfiles-workbench',
  schema: Schema.object({
    rightPanel: Schema.union([
      Schema.const('native').description('Per-thread (the native right sidebar)'),
      Schema.const('dock').description('Global dock (persistent panels in the right column)'),
    ])
      .default('native')
      .description(
        'Which surface fills the right column: the native per-thread right sidebar, or the global dock, whose layout and panel set are the same in every thread.',
      ),
    headerToggle: Schema.boolean()
      .default(false)
      .description(
        'Show a button in the conversation header that toggles the workbench in the right side panel. Off keeps the header for thread state; the side panel opens from its own rail.',
      ),
    demoPanels: Schema.boolean()
      .default(false)
      .description('Developer fixtures: offer the Scratchpad and Ticker panels, which count mounts and renders to prove docking never remounts a panel.'),
  }),
  applies: 'live',
})
