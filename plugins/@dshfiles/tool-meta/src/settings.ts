import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const toolMetaSettings = defineSettings({
  namespace: 'dshfiles-tool-meta',
  schema: Schema.object({
    enabled: Schema.boolean().default(true).description('Show when each tool call started and how long it took, counting live while it runs.'),
    timeFormat: Schema.union([
      Schema.const('absolute').description('Clock time: 14:02:11, with the date when it is not today.'),
      Schema.const('relative').description('Relative: 12 s ago, 5 min ago.'),
    ])
      .default('absolute')
      .description('How the start time of a tool call reads.'),
    approvalCard: Schema.boolean()
      .default(true)
      .description('Show tool approval requests as a card with a risk badge, the command and the Enter / Escape keys. Off shows the native approval panel.'),
    fileCards: Schema.boolean()
      .default(true)
      .description(
        'Show `read` results as a syntax-highlighted code card, and `edit` / `write` / `apply_patch` as collapsible diffs. Off keeps the native rows; `apply_patch` has no native card and keeps its diff.',
      ),
  }),
  applies: 'live',
})
