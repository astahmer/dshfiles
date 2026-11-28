import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const paletteSettings = defineSettings({
  namespace: 'dshfiles-command-palette',
  schema: Schema.object({
    threadsScope: Schema.union([Schema.const('project').description('Current project'), Schema.const('all').description('All projects')])
      .default('project')
      .description(
        'Threads the Threads tab lists: the current project’s (its thread workspaces included), or every project’s. Without a current project it lists them all.',
      ),
    messageSelectBehavior: Schema.union([
      Schema.const('reveal').description('Open thread and scroll to message'),
      Schema.const('open').description('Open thread only'),
    ])
      .default('reveal')
      .description('What happens when you pick a match in the Messages tab: open the thread and scroll to the matched message, or only open the thread.'),
  }),
  applies: 'live',
})

export type PaletteSettings = SettingsValue<typeof paletteSettings.schema>
