import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const settingsShellSettings = defineSettings({
  namespace: 'dshfiles-settings-shell',
  schema: Schema.object({
    // Retired: Settings is one page in the stage (plans/ade-ux §4.6). Kept hidden so a saved value still validates.
    openIn: Schema.union([Schema.const('auto'), Schema.const('tab'), Schema.const('modal'), Schema.const('sidebar')])
      .default('auto')
      .hidden()
      .description('Retired: the gear, the palette and Mod+, always open the Settings page in the stage.'),
    welcomeNoticeVersion: Schema.string().default('').hidden().description('The welcome notice version last acknowledged.'),
    // The one TypeSafe Jev key (plans/ade-ux §4.6): backlog and memory read it; their own older keys are the fallback.
    jevSecret: Schema.string()
      .role('secret-ref')
      .default('')
      .description(
        "Secret Catalog alias holding the TypeSafe key that Backlog triage and Memory's signal gates use, written as secret:ALIAS or secret:ALIAS@env. The value never leaves the Host. Leave blank to use each plugin's earlier key, then TYPESAFE_API_KEY from the Host environment.",
      ),
  }),
  applies: 'live',
})

export type SettingsShellSettings = SettingsValue<typeof settingsShellSettings.schema>
