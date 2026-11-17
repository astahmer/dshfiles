import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const projectAutomationsSettings = defineSettings({
  namespace: 'dshfiles-project-automations',
  schema: Schema.object({
    githubDeliveryWindowHours: Schema.natural()
      .min(1)
      .max(168)
      .default(24)
      .description(
        'How long a GitHub delivery id is remembered, so a redelivery cannot start another thread.',
      ),
  }),
  applies: 'live',
})

export type ProjectAutomationsSettings = SettingsValue<typeof projectAutomationsSettings.schema>
