import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const settingsShellSettings = defineSettings({
  namespace: 'dshfiles-settings-shell',
  schema: Schema.object({
    // Retired: Settings is one page in the stage (plans/ade-ux §4.6). Kept hidden so a saved value still validates.
    openIn: Schema.union([Schema.const('auto'), Schema.const('tab'), Schema.const('modal'), Schema.const('sidebar')])
      .default('auto')
      .hidden()
      .description('Retired: the gear, the palette and Mod+, always open the Settings page in the stage.'),
    welcomeNoticeVersion: Schema.string().default('').hidden().description('The welcome notice version last acknowledged.'),
  }),
  applies: 'live',
})
