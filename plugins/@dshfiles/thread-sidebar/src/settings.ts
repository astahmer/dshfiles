import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'
import { ATTENTION_COLOR_OPTIONS, DEFAULT_PREFERENCES, REBASED_THREAD_ARCHIVE_DELAYS } from './organization.js'
import { threadNotificationCategoriesSchema } from './thread-notifications.js'
import { DEFAULT_THREAD_VIEW_SETTINGS } from './thread-view-preferences.js'

const ids = (): Schema<string[]> => Schema.array(Schema.string()).default([]).hidden()

/** Schemastery validates mutable arrays, so the saved-view default is cloned field by field. */
const threadViewsDefault = {
  ...DEFAULT_THREAD_VIEW_SETTINGS,
  views: DEFAULT_THREAD_VIEW_SETTINGS.views.map(view => ({ ...view, statusFilters: [...view.statusFilters] })),
}

export const threadSidebarSettings = defineSettings({
  namespace: 'thread-sidebar',
  schema: Schema.object({
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
    threadRowTitle: Schema.boolean().default(DEFAULT_PREFERENCES.threadRowTitle).description('Show the thread title.'),
    threadRowMachine: Schema.boolean().default(DEFAULT_PREFERENCES.threadRowMachine).description('Show the machine the DSH Host runs on.'),
    threadRowPath: Schema.boolean().default(DEFAULT_PREFERENCES.threadRowPath).description('Show the full working directory path.'),
    threadRowTime: Schema.boolean().default(DEFAULT_PREFERENCES.threadRowTime).description('Show the last activity time.'),
    threadRowStatusDot: Schema.boolean().default(DEFAULT_PREFERENCES.threadRowStatusDot).description('Show the running / unread status dot.'),
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
    notificationCategories: Schema.transform(Schema.any(), value => threadNotificationCategoriesSchema.parse(value))
      .default(DEFAULT_PREFERENCES.notificationCategories)
      .hidden(),
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
    autoArchiveEnabled: Schema.boolean().default(DEFAULT_PREFERENCES.autoArchiveEnabled).description('Archive idle threads automatically.'),
    rebasedThreadArchiveDelay: Schema.union(REBASED_THREAD_ARCHIVE_DELAYS)
      .default(DEFAULT_PREFERENCES.rebasedThreadArchiveDelay)
      .description('Archive successfully rebased threads immediately or after a delay. Running or waiting threads are never archived.'),
    idleMinutes: Schema.natural()
      .min(15)
      .max(10080)
      .default(DEFAULT_PREFERENCES.idleMinutes)
      .description('Idle threshold in minutes before threads move to Inactive; auto-archive uses the same threshold.'),
    scanIntervalMinutes: Schema.natural()
      .min(1)
      .max(120)
      .default(DEFAULT_PREFERENCES.scanIntervalMinutes)
      .description('How often auto-archive checks, in minutes.'),
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
    autoArchiveSessionIds: ids(),
    autoArchiveDisabledSessionIds: ids(),
    parkedSessionIds: ids(),
    mutedThreads: Schema.dict(Schema.object({ until: Schema.union([Schema.const(null), Schema.natural()]), activityAt: Schema.natural() }))
      .default({})
      .hidden(),
    collapsedSections: Schema.array(Schema.union(['pinned', 'active', 'parked', 'inactive', 'archived'] as const))
      .default(DEFAULT_PREFERENCES.collapsedSections)
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
