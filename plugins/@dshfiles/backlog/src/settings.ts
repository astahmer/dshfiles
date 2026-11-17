import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'
import { BacklogTemplates } from './templates.js'

export const backlogSettings = defineSettings({
  namespace: 'dshfiles-backlog',
  schema: Schema.object({
    autoTriage: Schema.boolean()
      .default(false)
      .description('Triage every new item in the background with Jev and/or the cheap model below. Off leaves items in the Inbox until you move them.'),
    jevEnabled: Schema.boolean()
      .default(false)
      .description(
        'Ask TypeSafe\'s Jev whether an item is real work and whether it repeats an open item (needs the Jev key).',
      ),
    // Moved to the one shared key in Settings › Tools & MCP › Jev (settings-shell). Kept, hidden, as the fallback while
    // the shared key is empty, so moving it loses nothing and clearing the shared key restores this value.
    jevSecret: Schema.string()
      .role('secret-ref')
      .default('')
      .hidden()
      .description('Earlier Backlog-only TypeSafe key reference. Set the key once in Settings › Tools & MCP › Jev instead.'),
    triageProvider: Schema.string()
      .default('')
      .description('Provider id for the triage model (as the model picker names it). Empty skips the model; Jev alone still triages.'),
    triageModel: Schema.string().default('').description('A cheap model on that provider, e.g. a flash or haiku model.'),
    imageTitle: Schema.boolean()
      .default(false)
      .description(
        'Title image-only captures with a vision model (needs a triage model that accepts images).',
      ),
    applyThreshold: Schema.number()
      .min(0)
      .max(1)
      .step(0.05)
      .default(0.8)
      .description('Confidence at or above which triage applies on its own. Below it, the suggestion waits on the item for you to accept or dismiss.'),
    lifecycleSignals: Schema.boolean()
      .default(true)
      .description(
        'Update item status from thread mentions, landed revisions and failed turns, never over a status you set.',
      ),
    idleThreadNudgeDays: Schema.natural()
      .max(3_650)
      .default(0)
      .description('Opt in to idle-thread nudges by setting a positive day count. Unfinished items on idle threads then ask for review.'),
    leaseIdleMinutes: Schema.natural()
      .min(1)
      .max(1_440)
      .default(30)
      .description(
        'Minutes an agent keeps a claimed item without writing to it before the claim lapses.',
      ),
    threadResolution: Schema.union([
      Schema.const('off').description('Off: a finished thread never suggests anything'),
      Schema.const('propose').description("Propose: ask Jev whether the thread's last reply resolved its open items, and leave a Done suggestion on each"),
    ])
      .default('off')
      .description(
        'Let Jev suggest closing In progress items when their thread ends a turn, never closing one by itself.',
      ),
    reuseCaptureProject: Schema.boolean()
      .default(true)
      .description(
        'Put the next capture in the project of the last one.',
      ),
    startThreadOpensCreated: Schema.boolean()
      .default(false)
      .description(
        'Open a thread started from a backlog item as soon as it exists.',
      ),
    smartThreadRouting: Schema.boolean()
      .default(false)
      .description(
        'Start a linked @dsh thread when a plain item reply asks for work (other replies stay replies).',
      ),
    threadStartNotifications: Schema.union([Schema.const('off'), Schema.const('in-app'), Schema.const('system'), Schema.const('both')])
      .default('in-app')
      .description(
        'Show a notice when a reply starts a thread.',
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
      .description(
        'How often main, linked pull requests and linked issues are checked.',
      ),
    watchLinkedPullRequests: Schema.boolean()
      .default(true)
      .description(
        'Track pull requests that open items link, and close an item when its `fixes` PR merges.',
      ),
    linkedIssueStates: Schema.boolean()
      .default(true)
      .description(
        'Read the state of GitHub issues that open items link, and close an item when its `fixes` issue is completed.',
      ),
    dormantAfterDays: Schema.object({
      note: Schema.natural().max(3_650).default(14),
      idea: Schema.natural().max(3_650).default(30),
      question: Schema.natural().max(3_650).default(30),
      task: Schema.natural().max(3_650).default(30),
      bug: Schema.natural().max(3_650).default(30),
    }).description(
      'Idle days before an open item of this kind leaves the default views (0 keeps it visible).',
    ),
    inboxThreads: Schema.union([
      Schema.const('off').description('Off: the Inbox shows backlog items only'),
      Schema.const('failures').description('Failures: threads linked to an item whose last turn was blocked or errored'),
      Schema.const('all').description('All: also linked threads whose turn finished and wait for review'),
    ])
      .default('failures')
      .description("Which threads from the sidebar's unread list also appear in the Inbox, next to the backlog items they work on."),
    peers: Schema.array(
      Schema.object({
        runtimeId: Schema.string().required(),
        enabled: Schema.boolean().default(false),
      }),
    )
      .default([])
      .hidden()
      .description('Other hosts whose backlog this host pulls. Turn them on in Backlog settings › Hosts.'),
    peerPullSeconds: Schema.natural()
      .min(10)
      .max(3_600)
      .default(60)
      .description('How often each enabled host is asked for backlog changes. Offline hosts catch up later.'),
    automationHost: Schema.string()
      .default('')
      .hidden()
      .description(
        'The host that runs checks when hosts share the backlog. Empty: this host. Pick it in Backlog settings › Hosts.',
      ),
    publishActivity: Schema.boolean()
      .default(true)
      .description('Report item moves, links and requests for input to the Activity timeline, so the shared activity room shows backlog work.'),
    syncBackends: Schema.array(
      Schema.object({
        project: Schema.string().default('').description('Absolute project path this backend serves. Empty serves every project that has no row of its own.'),
        backend: Schema.union([Schema.const('linear').description('Linear'), Schema.const('github').description('GitHub Issues')]).default('linear'),
        enabled: Schema.boolean().default(true),
        target: Schema.string().default('').description('Linear team key (for example ENG) or GitHub owner/repo.'),
        secret: Schema.string()
          .role('secret-ref')
          .default('')
          .description(
            'A Linear API key or GitHub token as secret:ALIAS, or empty to use LINEAR_API_KEY or GITHUB_TOKEN.',
          ),
        autoSyncMinutes: Schema.natural()
          .max(1_440)
          .default(0)
          .description('Sync every linked item of this project on this interval. 0 syncs only when you press Sync now.'),
        pushAgentComments: Schema.boolean()
          .default(false)
          .description('Also post comments agents write on linked items to the remote issue. Off: only your own comments are posted.'),
      }),
    )
      .default([])
      .hidden()
      .description(
        'Earlier remote sync rows, moved once into Backlog settings › Remote sync and no longer read.',
      ),
    savedViews: Schema.array(
      Schema.object({
        name: Schema.string().required(),
        view: Schema.union([
          Schema.const('feed'),
          Schema.const('inbox'),
          Schema.const('ready'),
          Schema.const('items'),
          Schema.const('board'),
          Schema.const('projects'),
          Schema.const('shipped'),
        ]).default('items'),
        query: Schema.string().default(''),
      }),
    )
      .default([])
      .description('Searches saved from the Backlog panel, shared by every browser.'),
    templates: Schema.array(
      Schema.object({
        name: Schema.string().required().description('What the capture picker and `/template <name>` call it.'),
        titlePrefix: Schema.string().default('').description('Put before the captured title, such as "[Bug] ".'),
        kind: Schema.union([Schema.const('task'), Schema.const('bug'), Schema.const('idea'), Schema.const('note'), Schema.const('question')]).default('task'),
        priority: Schema.union([Schema.const('none'), Schema.const('urgent'), Schema.const('high'), Schema.const('medium'), Schema.const('low')]).default(
          'none',
        ),
        tags: Schema.array(Schema.string()).default([]),
        body: Schema.string().default('').description('Appended after what you typed: headings to fill in, a checklist.'),
        criteria: Schema.array(Schema.string()).default([]).description('Acceptance criteria the item starts with, unchecked.'),
      }),
    )
      .default(BacklogTemplates.defaults.map(template => ({ ...template, tags: [...template.tags], criteria: [...template.criteria] })))
      .description('Templates a capture can start from: the capture box picker, `/template <name>` in the text, or backlog_capture `template`.'),
    projectGuidance: Schema.array(
      Schema.object({
        project: Schema.string().required().description('Absolute project path.'),
        guidance: Schema.string().default('').description('Markdown for agents: conventions, commands, what not to touch.'),
      }),
    )
      .default([])
      .description(
        'Standing instructions per project that open each thread started from its items, edited in the Projects view.',
      ),
  }),
  applies: 'live',
})

export type BacklogSettings = SettingsValue<typeof backlogSettings.schema>
