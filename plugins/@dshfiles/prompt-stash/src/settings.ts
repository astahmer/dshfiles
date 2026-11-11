import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const promptStashSettings = defineSettings({
  namespace: 'dshfiles-prompt-stash',
  schema: Schema.object({
    promptHistory: Schema.boolean()
      .default(true)
      .description('Search every prompt you sent across threads from the Prompts menu, Ctrl+R in the composer and the command palette.'),
    historyRetention: Schema.natural()
      .min(100)
      .max(50_000)
      .default(5_000)
      .description('How many of your newest prompts the history searches. Older prompts stay in their threads.'),
    historyMaxChars: Schema.natural()
      .min(200)
      .max(65_536)
      .default(8_000)
      .description('Prompts longer than this many characters (large pastes, logs) are left out of the history.'),
  }),
  applies: 'live',
})

export type PromptStashSettings = SettingsValue<typeof promptStashSettings.schema>
