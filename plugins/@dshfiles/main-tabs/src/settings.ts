import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'
import { CLOSE_BUTTON_POSITIONS, DEFAULT_CLOSE_BUTTON_POSITION } from '@dshfiles/workbench/tabs'

export const mainTabsSettings = defineSettings({
  namespace: 'dshfiles-main-tabs',
  schema: Schema.object({
    enabled: Schema.boolean().default(true).description('Show browser-like tabs above the main view for threads and panels.'),
    focusThreadInSidebar: Schema.boolean().default(true).description('Scroll the matching thread into view in the sidebar when selecting a thread tab.'),
    closeButtonPosition: Schema.union(CLOSE_BUTTON_POSITIONS)
      .default(DEFAULT_CLOSE_BUTTON_POSITION)
      .description('Place tab close buttons to the left or right of titles in the main strip and Workbench headers.'),
    maxTabs: Schema.natural().min(2).max(50).default(12).description('Most tabs kept open; past it the least recently used unpinned tab closes.'),
    openMode: Schema.union([
      Schema.const('preview').description('Preview: what you open from the sidebar replaces the preview tab until you keep it (double-click).'),
      Schema.const('new').description('New tab: everything you open gets its own tab.'),
      Schema.const('replace').description('Replace: what you open replaces the current tab, unless it is pinned.'),
    ])
      .default('preview')
      .description('What opening a thread or panel from outside the tab strip does.'),
    persistence: Schema.union([
      Schema.const('project').description('Per project: each project keeps its own tabs.'),
      Schema.const('global').description('Global: one set of tabs for every project.'),
    ])
      .default('project')
      .description('Whether tabs are kept per project or shared by all of them.'),
  }),
  applies: 'live',
})
