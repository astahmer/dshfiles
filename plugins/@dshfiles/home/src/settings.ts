import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const homeSettings = defineSettings({
  namespace: 'dshfiles-home',
  schema: Schema.object({
    mark: Schema.union([
      Schema.const('none').description('No mark.'),
      Schema.const('text').description('The text below, e.g. an emoji.'),
      Schema.const('image').description('The image at the URL below.'),
    ])
      .default('none')
      .description('What replaces the DeepSeek mark on the New thread screen.'),
    markText: Schema.string().default('').description('Text or emoji shown as the mark.'),
    markImageUrl: Schema.string().default('').description('Image URL shown as the mark (https: or data:).'),
    headline: Schema.string()
      .default('{project}')
      .description('Headline on the New thread screen; `{project}` is the selected project. Empty keeps the DeepSeek headline.'),
    showPreviewBadge: Schema.boolean().default(false).description('Keep the DeepSeek “Preview” badge next to the headline.'),
    showAgentPresetPicker: Schema.boolean()
      .default(true)
      .description(
        'Show the agent preset (Standard mode, …) picker on the New thread screen. Hidden, new threads use the preset marked “New task default” in Settings › Agent presets.',
      ),
    showRecentThreads: Schema.boolean().default(true).description('List the project’s most recent threads above the composer to resume one.'),
    showUnlandedWork: Schema.boolean().default(true).description('Show how many of the project’s thread workspaces have work to rebase.'),
  }),
})

export type HomeSettings = SettingsValue<typeof homeSettings.schema>
