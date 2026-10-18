import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const settingsShellSettings = defineSettings({
  namespace: 'dshfiles-settings-shell',
  schema: Schema.object({
    openIn: Schema.union([
      Schema.const('auto').description('Automatic: a main-view tab when Main tabs is loaded, the dialog otherwise.'),
      Schema.const('tab').description('Tab: always open Settings in the main view.'),
      Schema.const('modal').description('Dialog: always open Settings as a dialog over the current view.'),
      Schema.const('sidebar').description('Side panel: open Settings as a tab in the thread’s side panel.'),
    ])
      .default('auto')
      .description('Where the gear, the palette and Mod+, open Settings.'),
    welcomeNoticeVersion: Schema.string().default('').hidden().description('The welcome notice version last acknowledged.'),
  }),
  applies: 'live',
})
