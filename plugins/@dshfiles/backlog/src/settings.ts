import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const backlogSettings = defineSettings({
  namespace: 'dshfiles-backlog',
  schema: Schema.object({
    autoTriage: Schema.boolean()
      .default(false)
      .description('Triage every new item in the background with Jev and/or the cheap model below. Off leaves items in the Inbox until you move them.'),
    jevEnabled: Schema.boolean()
      .default(false)
      .description("Ask TypeSafe's Jev whether an item is work to do and whether it repeats an open item. Needs TYPESAFE_API_KEY in the Host environment."),
    triageProvider: Schema.string()
      .default('')
      .description('Provider id for the triage model (as the model picker names it). Empty skips the model; Jev alone still triages.'),
    triageModel: Schema.string().default('').description('A cheap model on that provider, e.g. a flash or haiku model.'),
    applyThreshold: Schema.number()
      .min(0)
      .max(1)
      .step(0.05)
      .default(0.8)
      .description('Confidence at or above which triage applies on its own. Below it, the suggestion waits on the item for you to accept or dismiss.'),
  }),
  applies: 'live',
})

export type BacklogSettings = SettingsValue<typeof backlogSettings.schema>
