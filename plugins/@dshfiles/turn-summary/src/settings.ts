import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const turnSummarySettings = defineSettings({
  namespace: 'dshfiles-turn-summary',
  schema: Schema.object({
    enabled: Schema.boolean().default(true).description('Show a one-line summary of the tool work under each finished turn.'),
    includeReads: Schema.boolean().default(true).description('Count file reads and searches in the summary, not only commands and edits.'),
    listFailures: Schema.boolean().default(true).description('Let the failed-command count open a list naming each failed command and how it ended.'),
  }),
  applies: 'live',
})
