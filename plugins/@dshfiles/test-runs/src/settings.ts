import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const testRunsSettings = defineSettings({
  namespace: 'dshfiles-test-runs',
  schema: Schema.object({
    enabled: Schema.boolean().default(true).description('Show a Vitest run as a test-results card instead of the terminal output.'),
    runningCard: Schema.boolean().default(true).description('While a Vitest command runs, show a running test card instead of the bash row.'),
    composerActions: Schema.boolean().default(true).description('Offer Ask to fix and Rerun on a failing test; both fill the composer without sending.'),
    openFailures: Schema.boolean().default(true).description('Open the card, its failing files and their failing tests as soon as the run settles.'),
  }),
  applies: 'live',
})
