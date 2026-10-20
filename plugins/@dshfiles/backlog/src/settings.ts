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
    startThreadSendsFirstMessage: Schema.boolean()
      .default(true)
      .description(
        'When a thread is started from an item, send its prefilled first message at once. Off opens the thread with that text as a draft you can edit before sending.',
      ),
    revisionRepositories: Schema.array(Schema.string())
      .default([])
      .description('Repositories whose main bookmark is read for "Closes b:<n>", besides every project an open item names.'),
    revisionPollMinutes: Schema.natural()
      .min(1)
      .max(120)
      .default(5)
      .description('How often main is checked. A check that finds main unchanged costs one jj call.'),
    dormantAfterDays: Schema.object({
      note: Schema.natural().max(3_650).default(14),
      idea: Schema.natural().max(3_650).default(30),
      question: Schema.natural().max(3_650).default(30),
      task: Schema.natural().max(3_650).default(30),
      bug: Schema.natural().max(3_650).default(30),
    }).description(
      'Idle days before an open item of each kind leaves the default views (it stays searchable). 0 keeps that kind visible forever. Items asking for attention, pinned items and work in progress never go dormant.',
    ),
    inboxThreads: Schema.union([
      Schema.const('off').description('Off: the Inbox shows backlog items only'),
      Schema.const('failures').description('Failures: threads linked to an item whose last turn was blocked or errored'),
      Schema.const('all').description('All: also linked threads whose turn finished and wait for review'),
    ])
      .default('failures')
      .description("Which threads from the sidebar's unread list also appear in the Inbox, next to the backlog items they work on."),
    publishActivity: Schema.boolean()
      .default(true)
      .description('Report item moves, links and requests for input to the Activity timeline, so the shared activity room shows backlog work.'),
    savedViews: Schema.array(
      Schema.object({
        name: Schema.string().required(),
        view: Schema.union([Schema.const('feed'), Schema.const('inbox'), Schema.const('items'), Schema.const('board'), Schema.const('projects')]).default(
          'items',
        ),
        query: Schema.string().default(''),
      }),
    )
      .default([])
      .description('Searches saved from the Backlog panel, shared by every browser.'),
  }),
  applies: 'live',
})

export type BacklogSettings = SettingsValue<typeof backlogSettings.schema>
