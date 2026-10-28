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
      .description(
        "Ask TypeSafe's Jev whether an item is work to do and whether it repeats an open item. Needs a key: bind one below, or set TYPESAFE_API_KEY in the Host environment.",
      ),
    jevSecret: Schema.string()
      .role('secret-ref')
      .default('')
      .description('Secret Catalog alias holding the TypeSafe key, written as secret:ALIAS or secret:ALIAS@env. The value never leaves the Host.'),
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
        'Move items on their own: a user message mentioning b:12 links that thread and starts the item; a revision on main saying "Closes b:12" finishes it; a linked thread whose turn ended blocked or failed flags its open items as blocked, and its next finished turn clears that flag; an answered question settles the request for input its own thread raised. Never overrides a status or attention you set by hand.',
      ),
    idleThreadNudgeDays: Schema.natural()
      .max(3_650)
      .default(0)
      .description('Opt in to idle-thread nudges by setting a positive day count. Unfinished items on idle threads then ask for review.'),
    threadResolution: Schema.union([
      Schema.const('off').description('Off: a finished thread never suggests anything'),
      Schema.const('propose').description("Propose: ask Jev whether the thread's last reply resolved its open items, and leave a Done suggestion on each"),
    ])
      .default('off')
      .description(
        'When a thread finishes a turn while its items are still In progress, Jev can suggest closing them. Needs jevEnabled and a key; the suggestion waits on the item, it never moves one on its own.',
      ),
    reuseCaptureProject: Schema.boolean()
      .default(true)
      .description(
        'Remember the project of the last capture, so the next item lands in the same project. Off starts every capture with no project unless the header filters by one.',
      ),
    startThreadOpensCreated: Schema.boolean()
      .default(false)
      .description(
        'Open threads started from a backlog item as soon as they exist, including threads started by an @agent comment. Off leaves you where you were and the report offers to open the thread; the dialog checkbox overrides this setting for one thread.',
      ),
    smartThreadRouting: Schema.boolean()
      .default(false)
      .description(
        'When enabled, classify plain item replies as discussion or work requests. Work requests start a linked @dsh thread; other messages remain replies. Uses Jev when enabled and conservative keyword matching otherwise. Off keeps every plain reply as context; @agent remains an explicit dispatch.',
      ),
    threadStartNotifications: Schema.union([Schema.const('off'), Schema.const('in-app'), Schema.const('system'), Schema.const('both')])
      .default('in-app')
      .description(
        'Deliver a notice when a reply starts a thread. System delivery uses this browser’s notification permission; in-app notices include an Open action.',
      ),
    replyThreadThreshold: Schema.number()
      .min(0)
      .max(1)
      .step(0.05)
      .default(0.7)
      .description('Minimum Jev confidence for automatically starting a thread from an item reply. Keyword fallback is used if Jev is off or unavailable.'),
    smartReplyAnswers: Schema.boolean()
      .default(true)
      .description('Generate a short AI answer comment for reply-worthy text-only item replies. Work requests still start a linked thread.'),
    replyAgent: Schema.string()
      .default('')
      .description('Preferred agent for generated item replies. If unavailable, the other selection source is tried, then @dsh.'),
    replyAgentOrder: Schema.union([Schema.const('preferred'), Schema.const('last-used')])
      .default('preferred')
      .description('Try the configured preferred agent before the item’s most recently linked agent, or reverse the order; @dsh is the final fallback.'),
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
