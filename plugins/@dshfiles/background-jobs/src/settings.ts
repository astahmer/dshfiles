import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const backgroundJobsSettings = defineSettings({
  namespace: 'dshfiles-background-jobs',
  schema: Schema.object({
    stopOutlivedAfterMinutes: Schema.natural()
      .max(10_080)
      .default(120)
      .description(
        'Stop a background job once it has outlived the turn that started it for this many minutes: its thread is idle, settled or archived, so nothing reads it. 0 keeps such jobs running until stopped by hand.',
      ),
  }),
  applies: 'live',
})

export type BackgroundJobsSettings = ReturnType<typeof backgroundJobsSettings.schema>
