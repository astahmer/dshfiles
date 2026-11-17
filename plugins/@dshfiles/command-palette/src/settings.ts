import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const paletteSettings = defineSettings({
  namespace: 'dshfiles-command-palette',
  schema: Schema.object({
    threadsScope: Schema.union([Schema.const('project').description('Current project'), Schema.const('all').description('All projects')])
      .default('project')
      .description(
        'Which threads the Threads tab lists: the current project’s, or every project’s.',
      ),
  }),
  applies: 'live',
})

export type PaletteSettings = SettingsValue<typeof paletteSettings.schema>
