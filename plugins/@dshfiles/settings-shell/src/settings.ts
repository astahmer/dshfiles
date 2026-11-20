import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const settingsShellSettings = defineSettings({
  namespace: 'dshfiles-settings-shell',
  schema: Schema.object({
    // Retired: Settings is one page in the stage (docs/ade-ux §4.6). Kept hidden so a saved value still validates.
    openIn: Schema.union([Schema.const('auto'), Schema.const('tab'), Schema.const('modal'), Schema.const('sidebar')])
      .default('auto')
      .hidden()
      .description('Retired: the gear, the palette and Mod+, always open the Settings page in the stage.'),
    welcomeNoticeVersion: Schema.string().default('').hidden().description('The welcome notice version last acknowledged.'),
    // A first-run surface most people never switch back on: under Advanced, not level with the release check.
    previewNotice: Schema.boolean()
      .default(false)
      .collapse()
      .description("Show DeepSeek Harness's own preview notice before the first thread. Off: Getting started's setup card is the only first-run surface."),
    releaseCheck: Schema.boolean()
      .default(true)
      .description(
        'Check GitHub every few hours for a newer DSH and badge Settings when there is one.',
      ),
    // The one TypeSafe Jev key (docs/ade-ux §4.6): backlog and memory read it; their own older keys are the fallback.
    jevSecret: Schema.string()
      .role('secret-ref')
      .default('')
      .description(
        "The TypeSafe key Backlog triage and Memory use, as secret:ALIAS. Blank uses TYPESAFE_API_KEY from DSH’s environment.",
      ),
  }),
  applies: 'live',
})

export type SettingsShellSettings = SettingsValue<typeof settingsShellSettings.schema>
