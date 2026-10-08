import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'
import { DEFAULT_PREFERENCES } from './organization.js'

const ids = (): Schema<string[]> => Schema.array(Schema.string()).default([]).hidden()

export const threadSidebarSettings = defineSettings({
  namespace: 'thread-sidebar',
  schema: Schema.object({
    headerMode: Schema.union(['compact', 'expanded'] as const)
      .default(DEFAULT_PREFERENCES.headerMode)
      .description('Compact shows one scrollable icon row; expanded shows labels and folds into the icon row at 76px or less.'),
    navigationDensity: Schema.union(['compact', 'comfortable'] as const).default(DEFAULT_PREFERENCES.navigationDensity).description('Row height of the expanded navigation list.'),
    navigationOverflow: Schema.union(['scroll', 'menu', 'scroll-menu'] as const)
      .default(DEFAULT_PREFERENCES.navigationOverflow)
      .description('Icon row overflow: scroll, overflow menu only, or scroll plus a pinned ⋮ menu.'),
    paletteRecentLimit: Schema.natural().min(5).max(100).default(DEFAULT_PREFERENCES.paletteRecentLimit).description('Recent threads shown when the palette search is empty.'),
    autoArchiveEnabled: Schema.boolean().default(DEFAULT_PREFERENCES.autoArchiveEnabled).description('Archive idle threads automatically.'),
    idleMinutes: Schema.natural().min(15).max(10080).default(DEFAULT_PREFERENCES.idleMinutes).description('Idle threshold in minutes before auto-archive.'),
    scanIntervalMinutes: Schema.natural().min(1).max(120).default(DEFAULT_PREFERENCES.scanIntervalMinutes).description('How often auto-archive checks, in minutes.'),
    paletteChord: Schema.union([Schema.const(null), Schema.string()]).default(DEFAULT_PREFERENCES.paletteChord).hidden(),
    threadSearchChord: Schema.union([Schema.const(null), Schema.string()]).default(DEFAULT_PREFERENCES.threadSearchChord).hidden(),
    excludedWorkspaceIds: ids(),
    excludedSessionIds: ids(),
    parkedSessionIds: ids(),
    collapsedSections: Schema.array(Schema.union(['pinned', 'active', 'parked', 'inactive', 'archived'] as const))
      .default(DEFAULT_PREFERENCES.collapsedSections)
      .hidden(),
    workspaceFilter: Schema.union([Schema.const(null), Schema.string()]).default(DEFAULT_PREFERENCES.workspaceFilter).hidden(),
    headerRegionHeight: Schema.union([Schema.const(null), Schema.natural()]).default(DEFAULT_PREFERENCES.headerRegionHeight).hidden(),
    headerOrder: ids(),
    hiddenHeaderIds: ids(),
    footerOrder: ids(),
    hiddenFooterIds: ids(),
  }),
  applies: 'live',
})
