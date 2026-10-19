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
    lifecycleSignals: Schema.boolean()
      .default(true)
      .description(
        'Move items on their own: a user message mentioning b:12 links that thread and starts the item; a revision on main saying "Closes b:12" finishes it. Never overrides a status you set by hand.',
      ),
    revisionRepositories: Schema.array(Schema.string())
      .default([])
      .description('Repositories whose main bookmark is read for "Closes b:<n>", besides every project an open item names.'),
    revisionPollMinutes: Schema.natural()
      .min(1)
      .max(120)
      .default(5)
      .description('How often main is checked. A check that finds main unchanged costs one jj call.'),
  }),
  applies: 'live',
})

export type BacklogSettings = SettingsValue<typeof backlogSettings.schema>
