import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const workbenchSettings = defineSettings({
  namespace: 'dshfiles-workbench',
  schema: Schema.object({
    // Decode old saved profiles without exposing an obsolete surface choice.
    // Main content is always tabbed; rightPanel is read only for first-run visibility migration.
    mainSurface: Schema.union(['native', 'workbench']).default('workbench').hidden(),
    rightPanel: Schema.union(['native', 'dock']).default('native').hidden(),
    headerToggle: Schema.boolean().default(false).hidden(),
    bottomPanel: Schema.union([Schema.const('hidden').description('Hidden'), Schema.const('shown').description('Shown below the centre')])
      .default('hidden')
      .description('Show the tabbed bottom pane below the left and centre columns. The right pane remains full height.'),
    demoPanels: Schema.boolean()
      .default(false)
      .description('Developer fixtures: offer the Scratchpad and Ticker panels, which count mounts and renders to prove docking never remounts a panel.'),
  }),
  applies: 'live',
})
