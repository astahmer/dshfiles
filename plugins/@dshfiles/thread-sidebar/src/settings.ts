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
    layoutMode: Schema.union([
      Schema.const('fixed').description('Fixed: the rail of destinations and one list'),
      Schema.const('docking').description('Free docking: movable panes in the left column'),
    ])
      .default(DEFAULT_PREFERENCES.layoutMode)
      .description(
        'Layout of the left column. Free docking brings back the movable panes and your saved docking layout; switching back keeps it for next time.',
      ),
    headerMode: Schema.union(['compact', 'expanded'] as const)
      .default(DEFAULT_PREFERENCES.headerMode)
      .description('Compact shows one scrollable icon row; expanded shows labels and folds into the icon row at 76px or less.'),
    hideBrandLogo: Schema.boolean()
      .default(DEFAULT_PREFERENCES.hideBrandLogo)
      .description('Hide the brand logo and name in the sidebar header to make room; the collapse button stays.'),
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
    threadRowMachine: Schema.boolean().default(DEFAULT_PREFERENCES.threadRowMachine).description('Show the machine the DSH Host runs on.'),
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
      .description('Include child session attention in groups, thread-row labels, and desktop alerts.'),
    desktopNotificationsEnabled: Schema.boolean().default(DEFAULT_PREFERENCES.desktopNotificationsEnabled).hidden(),
    notificationCategories: notificationCategories.hidden(),
    notificationPlacement: Schema.union(THREAD_NOTIFICATION_PLACEMENTS).default(DEFAULT_PREFERENCES.notificationPlacement).hidden(),
    notificationDurationSeconds: Schema.natural().max(60).default(DEFAULT_PREFERENCES.notificationDurationSeconds).hidden(),
    resumeAfterRestart: Schema.boolean()
      .default(DEFAULT_PREFERENCES.resumeAfterRestart)
      .description('When DSH starts again, continue the threads that were working when it stopped (a restart, a crash or a forced stop).'),
    applyActionsToChildThreads: Schema.boolean()
      .default(DEFAULT_PREFERENCES.applyActionsToChildThreads)
      .description('Apply manual pin, park, archive, and restore actions to all child threads.'),
    maxChildren: Schema.natural()
      .min(1)
      .max(50)
      .default(DEFAULT_PREFERENCES.maxChildren)
      .description('Child threads listed under a parent before the expandable "more" line.'),
    finishedSubagents: Schema.union(['show', 'collapse', 'hide'] as const)
      .default(DEFAULT_PREFERENCES.finishedSubagents)
      .description('Finished subagents under a parent: list them, fold them into one "N finished" line, or hide them.'),
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
      .description('Settle idle threads automatically: they stay listed and openable, but run no model step until unsettled.'),
    rebasedThreadSettleDelay: Schema.union(THREAD_DELAYS)
      .default(DEFAULT_PREFERENCES.rebasedThreadSettleDelay)
      .description('Settle successfully rebased threads immediately or after a delay. Running or waiting threads are never settled.'),
    settledArchiveDelay: Schema.union(THREAD_DELAYS)
      .default(DEFAULT_PREFERENCES.settledArchiveDelay)
      .description('Archive a settled thread once this delay has passed. Running, waiting, pinned or newly changed threads are never archived.'),
    // Written with the settled ids; the banner and the archive delay read it back.
    settledAt: Schema.dict(Schema.natural()).default({}).hidden(),
    idleMinutes: Schema.natural()
      .min(15)
      .max(10080)
      .default(DEFAULT_PREFERENCES.idleMinutes)
      .description('Idle threshold in minutes before threads move to Inactive; auto-settle uses the same threshold.'),
    scanIntervalMinutes: Schema.natural()
      .min(1)
      .max(120)
      .default(DEFAULT_PREFERENCES.scanIntervalMinutes)
      .description('How often auto-settle checks, in minutes.'),
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
  }),
  applies: 'live',
})
