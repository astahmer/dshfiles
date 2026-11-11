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
        'How long a GitHub delivery id stays remembered, so the same delivery cannot start another thread. GitHub redeliveries reuse the id on purpose and are refused inside the window; a captured request can still be replayed once it expires. Raises the number of remembered deliveries, not their safety.',
      ),
  }),
  applies: 'live',
})

export type ProjectAutomationsSettings = SettingsValue<typeof projectAutomationsSettings.schema>
