import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const turnSummarySettings = defineSettings({
  namespace: 'dshfiles-turn-summary',
  schema: Schema.object({
    enabled: Schema.boolean().default(true).description('Show a one-line summary of the tool work under each finished turn.'),
    includeReads: Schema.boolean().default(true).description('Count file reads and searches in the summary, not only commands and edits.'),
    listFailures: Schema.boolean().default(true).description('Let the failed-command count open a list naming each failed command and how it ended.'),
    lineCounts: Schema.boolean().default(true).description('Show lines added and removed next to the edited-file count, counted from the edit calls.'),
    testResults: Schema.boolean().default(true).description('Show passed / total tests from the last test-runner summary a command printed (Vitest, Jest, pytest).'),
    duration: Schema.boolean().default(true).description('Show how long the turn took, from its start to its end.'),
    openLists: Schema.boolean().default(true).description('Let the edited-file and command counts open their lists; each file opens in the editor.'),
  }),
  applies: 'live',
})
