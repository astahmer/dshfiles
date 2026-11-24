import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const backgroundJobsSettings = defineSettings({
  namespace: 'dshfiles-background-jobs',
  schema: Schema.object({
    stopOutlivedAfterMinutes: Schema.natural()
      .max(10_080)
      .default(120)
      .description(
        'Stop a background job this many minutes after its thread goes idle, done or archived (0 never stops it).',
      ),
    headerJobChip: Schema.boolean()
      .default(false)
      .description(
        'Also show DSH\'s "N background jobs" chip in the thread header. Off: a running job lives in the row above the composer, and in the transcript once it has finished.',
      ),
  }),
  applies: 'live',
})

export type BackgroundJobsSettings = ReturnType<typeof backgroundJobsSettings.schema>
