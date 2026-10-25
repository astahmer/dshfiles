import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

/** The review tab's Host-backed preferences; the row id owns the namespace. */
export const reviewSettings = defineSettings({
  namespace: 'dshfiles-pulls-review',
  schema: Schema.object({
    autoMarkViewed: Schema.boolean()
      .default(true)
      .description('Mark a changed file as viewed once its header scrolls past the review viewport. Never unmarks a file.'),
    classicReviewTab: Schema.boolean()
      .default(false)
      .description("Open the native one-file review tab instead of this plugin's all-files review. The plugin's surface resumes when this is off."),
  }),
  applies: 'live',
})

export type ReviewSettings = SettingsValue<typeof reviewSettings.schema>
