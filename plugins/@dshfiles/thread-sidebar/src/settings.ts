import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'
import {
  ATTENTION_COLOR_OPTIONS,
  DEFAULT_PREFERENCES,
  PROJECT_COLOR_PALETTES,
  SIDEBAR_ORDER_SECTIONS,
  SIDEBAR_SECTIONS,
  THREAD_ROW_ACTIONS,
} from './organization.js'
import { SUBSCRIPTION_DELIVERY_MODES, SUBSCRIPTION_NOTICE_LEVELS } from './subscription-levels.js'
import { THREAD_DELAYS } from './thread-delays.js'
import {
  DEFAULT_THREAD_NOTIFICATION_CATEGORIES,
  THREAD_NOTIFICATION_CATEGORIES,
  THREAD_NOTIFICATION_PLACEMENTS,
  type ThreadNotificationCategoryPreferences,
} from './thread-notifications.js'
import { DEFAULT_THREAD_VIEW_SETTINGS } from './thread-view-preferences.js'

const ids = (): Schema<string[]> => Schema.array(Schema.string()).default([]).hidden()

/**
 * Plain Schemastery only: the Host serializes this schema (`toJSON`) and every
 * browser rebuilds and runs it before it marks the namespace ready. A
 * `Schema.transform` closure does not survive that trip (its imports are gone
 * in the browser), so validation threw, the namespace never became ready, and
 * every sidebar preference fell back to per-browser storage.
 */
const notificationCategory = (fallback: ThreadNotificationCategoryPreferences): Schema<ThreadNotificationCategoryPreferences> =>
  Schema.object({
    delivery: Schema.union(['off', 'in-app', 'system', 'both'] as const).default(fallback.delivery),
    sound: Schema.boolean().default(fallback.sound),
    soundPreset: Schema.union(['soft', 'chime', 'bright', 'low'] as const).default(fallback.soundPreset),
    volume: Schema.number().min(0).max(1).default(fallback.volume),
  }).default({ ...fallback })

const notificationCategories = Schema.object(
  // SAFETY: the entries map every THREAD_NOTIFICATION_CATEGORIES member exactly once, which is the asserted key set.
  Object.fromEntries(THREAD_NOTIFICATION_CATEGORIES.map(category => [category, notificationCategory(DEFAULT_THREAD_NOTIFICATION_CATEGORIES[category])])) as {
    [Category in (typeof THREAD_NOTIFICATION_CATEGORIES)[number]]: Schema<ThreadNotificationCategoryPreferences>
  },
)

/** Schemastery validates mutable arrays, so the saved-view default is cloned field by field. */
const threadViewsDefault = {
  ...DEFAULT_THREAD_VIEW_SETTINGS,
  views: DEFAULT_THREAD_VIEW_SETTINGS.views.map(view => ({ ...view, statusFilters: [...view.statusFilters] })),
}

export const threadSidebarSettings = defineSettings({
  namespace: 'thread-sidebar',
  schema: Schema.object({
    // Retired by the one sidebar layout (b:952m): decoded for one release so the merge knows which layout a person used.
    layoutMode: Schema.union(['fixed', 'docking'] as const)
      .default(DEFAULT_PREFERENCES.layoutMode)
      .hidden(),
    // The merge marker: the layout the one-time merge found; null until a page migrated this Host.
    layoutMerge: Schema.union([Schema.const(null), Schema.const('fixed'), Schema.const('docking')])
      .default(DEFAULT_PREFERENCES.layoutMerge)
      .hidden(),
    headerMode: Schema.union(['compact', 'expanded'] as const)
      .default(DEFAULT_PREFERENCES.headerMode)
      .description('Compact shows one scrollable icon row; expanded shows labels and folds into the icon row at 76px or less.'),
    hideBrandLogo: Schema.boolean()
      .default(DEFAULT_PREFERENCES.hideBrandLogo)
      .description('Hide the brand logo and name in the sidebar header to make room; the collapse button stays.'),
    phoneEdgeSwipePanels: Schema.boolean()
      .default(DEFAULT_PREFERENCES.phoneEdgeSwipePanels)
      .description(
        'On a phone, swipe in from the right edge to open the thread panel (off by default: Android’s back gesture uses it).',
      ),
    phoneNavigation: Schema.union(['stack', 'drawer'] as const)
      .default(DEFAULT_PREFERENCES.phoneNavigation)
      .description(
        'On a phone, stack shows the thread list full screen with a tab bar, and drawer slides it in over the thread.',
      ),
    showFooter: Schema.boolean()
      .default(DEFAULT_PREFERENCES.showFooter)
      .description(
        'Show the row of controls under the thread list (off: they live in the rail and ⌘K).',
      ),
    showRailActions: Schema.boolean()
      .default(DEFAULT_PREFERENCES.showRailActions)
      .description(
        'Show Copy DSH URL, Pair a phone and a pending reload on the rail above Settings.',
      ),
    showRailRestart: Schema.boolean()
      .default(DEFAULT_PREFERENCES.showRailRestart)
      .description(
        'Show Restart DSH on the rail (off: the status strip shows it while updates wait).',
      ),
    showDeveloperPages: Schema.boolean()
      .default(DEFAULT_PREFERENCES.showDeveloperPages)
      .description(
        'List the pages for plugin authors (Component gallery, Plugin guide) in a Developer group at the end of Settings. Off: ⌘K still opens them.',
      ),
    navigationDensity: Schema.union(['compact', 'comfortable'] as const)
      .default(DEFAULT_PREFERENCES.navigationDensity)
      .description('Row height of the expanded navigation list.'),
    navigationOverflow: Schema.union(['scroll', 'menu', 'scroll-menu'] as const)
      .default(DEFAULT_PREFERENCES.navigationOverflow)
      .description('Icon row overflow: scroll, overflow menu only, or scroll plus a pinned ⋮ menu.'),
    paletteRecentLimit: Schema.natural()
      .min(5)
      .max(100)
      .default(DEFAULT_PREFERENCES.paletteRecentLimit)
      .description('Recent threads shown when the palette search is empty.'),
    threadRowDensity: Schema.union(['compact', 'comfortable'] as const)
      .default(DEFAULT_PREFERENCES.threadRowDensity)
      .description('Thread row size: compact fits more threads, comfortable adds spacing and larger titles.'),
    threadRowProject: Schema.boolean().default(DEFAULT_PREFERENCES.threadRowProject).description('Show the project name under each thread title.'),
    threadRowProjectColor: Schema.boolean()
      .default(DEFAULT_PREFERENCES.threadRowProjectColor)
      .description('Tint each project name with a stable colour of its own.'),
    projectColorPalette: Schema.union(PROJECT_COLOR_PALETTES)
      .default(DEFAULT_PREFERENCES.projectColorPalette)
      .description('Choose the accessible color family used for project labels.'),
    threadRowTitle: Schema.boolean().default(DEFAULT_PREFERENCES.threadRowTitle).description('Show the thread title.'),
    threadRowMachine: Schema.boolean().default(DEFAULT_PREFERENCES.threadRowMachine).description('Show the machine each thread runs on.'),
    threadRowPath: Schema.boolean().default(DEFAULT_PREFERENCES.threadRowPath).description('Show the full working directory path.'),
    threadRowTime: Schema.boolean().default(DEFAULT_PREFERENCES.threadRowTime).description('Show the last activity time.'),
    threadRowStatusDot: Schema.boolean().default(DEFAULT_PREFERENCES.threadRowStatusDot).description('Show the running / unread status dot.'),
    separateRemoteThreads: Schema.boolean()
      .default(DEFAULT_PREFERENCES.separateRemoteThreads)
      .description('Keep remote threads in a separate group instead of the current view’s status, date, or project groups.'),
    arrowKeysSwitchThread: Schema.boolean()
      .default(DEFAULT_PREFERENCES.arrowKeysSwitchThread)
      .description('Up/Down switches to the focused thread immediately; off moves row focus only until Enter or a click.'),
    // Toggled and reordered in Customize sidebar, so the generated form shows no raw list.
    hiddenRowActions: Schema.array(Schema.union(THREAD_ROW_ACTIONS)).default(DEFAULT_PREFERENCES.hiddenRowActions).hidden(),
    rowActionOrder: Schema.array(Schema.union(THREAD_ROW_ACTIONS)).default(DEFAULT_PREFERENCES.rowActionOrder).hidden(),
    approvalNeededDisplay: Schema.union(['group', 'label'] as const)
      .default(DEFAULT_PREFERENCES.approvalNeededDisplay)
      .description('Show approval requests in a separate attention group or as an inline thread-row label.'),
    inputNeededDisplay: Schema.union(['group', 'label'] as const)
      .default(DEFAULT_PREFERENCES.inputNeededDisplay)
      .description('Show user questions in a separate attention group or as an inline thread-row label.'),
    turnFinishedDisplay: Schema.union(['group', 'label'] as const)
      .default(DEFAULT_PREFERENCES.turnFinishedDisplay)
      .description('Show completed turns in a separate attention group or as an inline thread-row label.'),
    attentionColors: Schema.object({
      approvalNeeded: Schema.union(ATTENTION_COLOR_OPTIONS).default(DEFAULT_PREFERENCES.attentionColors.approvalNeeded),
      inputNeeded: Schema.union(ATTENTION_COLOR_OPTIONS).default(DEFAULT_PREFERENCES.attentionColors.inputNeeded),
      turnFinished: Schema.union(ATTENTION_COLOR_OPTIONS).default(DEFAULT_PREFERENCES.attentionColors.turnFinished),
    })
      .default(DEFAULT_PREFERENCES.attentionColors)
      .description('Semantic color used for each attention status dot and label.'),
    includeSubagentAttention: Schema.boolean()
      .default(DEFAULT_PREFERENCES.includeSubagentAttention)
      .description('Include subagent threads in attention groups, thread-row labels, and desktop alerts.'),
    desktopNotificationsEnabled: Schema.boolean().default(DEFAULT_PREFERENCES.desktopNotificationsEnabled).hidden(),
    notificationCategories: notificationCategories.hidden(),
    notificationPlacement: Schema.union(THREAD_NOTIFICATION_PLACEMENTS).default(DEFAULT_PREFERENCES.notificationPlacement).hidden(),
    notificationDurationSeconds: Schema.natural().max(60).default(DEFAULT_PREFERENCES.notificationDurationSeconds).hidden(),
    resumeAfterRestart: Schema.boolean()
      .default(DEFAULT_PREFERENCES.resumeAfterRestart)
      .description(
        'After a managed restart, continue once each thread whose turn it cut off (off by default: it spends a turn).',
      ),
    resumeAfterRestartMaxThreads: Schema.natural()
      .min(1)
      .max(20)
      .default(DEFAULT_PREFERENCES.resumeAfterRestartMaxThreads)
      .description('Most threads resumed automatically after one restart, newest first; the rest stay in Needs resume.'),
    resumeAfterRestartDelaySeconds: Schema.natural()
      .max(600)
      .default(DEFAULT_PREFERENCES.resumeAfterRestartDelaySeconds)
      .description('Seconds to wait after DSH starts before the automatic resume, so plugins and providers finish loading.'),
    autoRestartWhenIdle: Schema.boolean()
      .default(false)
      .description(
        'Restart DSH when idle to apply updates, after a 30 s notice (needs the supervised launcher).',
      ),
    autoRestartQuietSeconds: Schema.natural()
      .min(30)
      .max(3600)
      .default(60)
      .description('Seconds DSH must stay idle before the automatic restart; the last 30 s show the restart notice.'),
    subscriptionNoticeLevel: Schema.union(SUBSCRIPTION_NOTICE_LEVELS)
      .default('all')
      .description(
        'Which turn ends of a subscribed thread notify the thread watching it: all, outcomes, stuck or never.',
      ),
    subscriptionDelivery: Schema.union(SUBSCRIPTION_DELIVERY_MODES)
      .default('steer')
      .description(
        'Steer a notice into a watching thread’s live turn, or queue it for after that turn.',
      ),
    applyActionsToChildThreads: Schema.boolean()
      .default(DEFAULT_PREFERENCES.applyActionsToChildThreads)
      .description('Apply manual pin, snooze, archive, and restore actions to all child threads.'),
    maxChildren: Schema.natural()
      .min(1)
      .max(50)
      .default(DEFAULT_PREFERENCES.maxChildren)
      .description('Child threads listed under a parent before the expandable "more" line.'),
    finishedSubagents: Schema.union(['show', 'collapse', 'hide'] as const)
      .default(DEFAULT_PREFERENCES.finishedSubagents)
      .description('Finished subagents under a parent: list them, fold them into one "N finished" line, or hide them.'),
    subagentRunCards: Schema.boolean()
      .default(DEFAULT_PREFERENCES.subagentRunCards)
      .description(
        'Show the current step and the elapsed time on each working subagent\'s row above the composer.',
      ),
    archiveUndoEnabled: Schema.boolean()
      .default(DEFAULT_PREFERENCES.archiveUndoEnabled)
      .description('Show a temporary undo notice after manually archiving threads.'),
    archiveUndoDurationSeconds: Schema.natural()
      .min(1)
      .max(30)
      .default(DEFAULT_PREFERENCES.archiveUndoDurationSeconds)
      .description('How long the manual archive undo notice stays visible, in seconds.'),
    autoSettleEnabled: Schema.boolean()
      .default(DEFAULT_PREFERENCES.autoSettleEnabled)
      .description('Mark idle threads done automatically: they stay listed and openable, but run nothing until restored.'),
    rebasedThreadSettleDelay: Schema.union(THREAD_DELAYS)
      .default(DEFAULT_PREFERENCES.rebasedThreadSettleDelay)
      .description('Mark landed threads done immediately or after a delay. Running or waiting threads are never marked done.'),
    settledArchiveDelay: Schema.union(THREAD_DELAYS)
      .default(DEFAULT_PREFERENCES.settledArchiveDelay)
      .description('Archive a done thread once this delay has passed. Running, waiting, pinned or newly changed threads are never archived.'),
    // Written with the settled ids; the banner and the archive delay read it back.
    settledAt: Schema.dict(Schema.natural()).default({}).hidden(),
    idleMinutes: Schema.natural()
      .min(15)
      .max(10080)
      .default(DEFAULT_PREFERENCES.idleMinutes)
      .description('Minutes without activity before a thread counts as idle; marking idle threads done uses the same threshold.'),
    subagentSettleHours: Schema.natural()
      .max(720)
      .default(DEFAULT_PREFERENCES.subagentSettleHours)
      .description(
        'Mark an idle subagent thread done after this many hours and stop its jobs (0 turns it off).',
      ),
    remindersWakeEnabled: Schema.boolean()
      .default(DEFAULT_PREFERENCES.remindersWakeEnabled)
      .description(
        'Unsettle or restore a thread just before one of its reminders is due, so a settled or archived thread still runs its reminder instead of dropping it.',
      ),
    scanIntervalMinutes: Schema.natural()
      .min(1)
      .max(120)
      .default(DEFAULT_PREFERENCES.scanIntervalMinutes)
      .description('How often idle threads are checked, in minutes.'),
    paletteChord: Schema.union([Schema.const(null), Schema.string()])
      .default(DEFAULT_PREFERENCES.paletteChord)
      .hidden(),
    fileSearchChord: Schema.union([Schema.const(null), Schema.string()])
      .default(DEFAULT_PREFERENCES.fileSearchChord)
      .hidden(),
    threadSearchChord: Schema.union([Schema.const(null), Schema.string()])
      .default(DEFAULT_PREFERENCES.threadSearchChord)
      .hidden(),
    backChord: Schema.union([Schema.const(null), Schema.string()])
      .default(DEFAULT_PREFERENCES.backChord)
      .hidden(),
    forwardChord: Schema.union([Schema.const(null), Schema.string()])
      .default(DEFAULT_PREFERENCES.forwardChord)
      .hidden(),
    excludedWorkspaceIds: ids(),
    excludedSessionIds: ids(),
    autoSettleSessionIds: ids(),
    autoSettleDisabledSessionIds: ids(),
    parkedSessionIds: ids(),
    settledSessionIds: ids(),
    mutedThreads: Schema.dict(Schema.object({ until: Schema.union([Schema.const(null), Schema.natural()]), activityAt: Schema.natural() }))
      .default({})
      .hidden(),
    collapsedSections: Schema.array(Schema.union(SIDEBAR_SECTIONS)).default(DEFAULT_PREFERENCES.collapsedSections).hidden(),
    sectionOrder: Schema.array(Schema.union(SIDEBAR_ORDER_SECTIONS))
      .default([...DEFAULT_PREFERENCES.sectionOrder])
      .hidden(),
    collapsedGroups: Schema.array(Schema.string()).default(DEFAULT_PREFERENCES.collapsedGroups).hidden(),
    idleSectionOverrides: Schema.dict(Schema.object({ section: Schema.union(['active', 'inactive']), at: Schema.natural() }))
      .default({})
      .hidden(),
    workspaceFilter: Schema.union([Schema.const(null), Schema.string()])
      .default(DEFAULT_PREFERENCES.workspaceFilter)
      .hidden(),
    headerRegionHeight: Schema.union([Schema.const(null), Schema.natural()])
      .default(DEFAULT_PREFERENCES.headerRegionHeight)
      .hidden(),
    headerOrder: ids(),
    hiddenHeaderIds: ids(),
    footerOrder: ids(),
    hiddenFooterIds: ids(),
    // An internal document rather than a form field: the client validates it with the same zod schema it stores.
    threadViews: Schema.any().default(threadViewsDefault).hidden(),
    // The rail's folders (b:952m): written by the Host's sidebar tree verbs, validated with the sidebar-tree schema.
    sidebarTree: Schema.any().default({ revision: 0, folders: [], removed: [], tombstones: [] }).hidden(),
    // The Board page's view (E9): the client validates it with the board-view schema, as it does the saved views.
    boardView: Schema.any()
      .default({ ...DEFAULT_PREFERENCES.boardView, statusFilters: [], collapsedGroups: [], collapsedSections: [] })
      .hidden(),
  }),
  applies: 'live',
})
