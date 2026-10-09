import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const jujutsuSettings = defineSettings({
  namespace: 'dshfiles-jujutsu',
  schema: Schema.object({
    defaultView: Schema.union([Schema.const('graph').description('Revision graph'), Schema.const('source').description('Source Control')])
      .default('graph')
      .description('Tab shown when the Jujutsu panel opens.'),
    ancestorCount: Schema.natural().min(1).max(20).default(5).description('Ancestor groups (@-1 … @-N) shown in Source Control.'),
    fileView: Schema.union([Schema.const('tree').description('Tree'), Schema.const('flat').description('Flat')])
      .default('tree')
      .description('Layout of changed-file lists.'),
    diffExpanded: Schema.boolean().default(false).description('Expand the patch of an opened revision by default.'),
    diffLayout: Schema.union([
      Schema.const('auto').description('Auto (unified in the side panel, split on a wide main page)'),
      Schema.const('unified').description('Unified'),
      Schema.const('split').description('Split'),
    ])
      .default('auto')
      .description('Layout of rendered diffs.'),
    hideImmutable: Schema.boolean().default(false).description('Hide immutable revisions in the graph.'),
    mineOnly: Schema.boolean().default(false).description('Show only your own revisions (and the working copy) in the graph.'),
    dateHeadings: Schema.boolean().default(true).description('Group graph revisions under day headings.'),
    revisionLimit: Schema.natural().min(50).max(500).default(300).description('Revisions loaded into the graph.'),
    refreshMode: Schema.union([Schema.const('interval').description('Every interval'), Schema.const('manual').description('Manual only')])
      .default('interval')
      .description('How the revision graph and Source Control reload repository data.'),
    refreshIntervalSeconds: Schema.natural().min(10).default(60).description('Seconds between automatic refreshes while the panel is visible.'),
    refreshOnVisible: Schema.boolean().default(true).description('Refresh when the panel or window becomes visible again.'),
    composerBar: Schema.boolean().default(true).description('Show the changed-files bar above the composer when the Session folder is a JJ workspace.'),
    composerChips: Schema.boolean().default(true).description('Show workspace, folder and working-copy chips below the composer.'),
    composerBarBase: Schema.string()
      .default('parent')
      .description('Default base of the composer bar: `parent` (working copy vs @-), `trunk` (since trunk()), or a local bookmark name.'),
  }),
  applies: 'live',
})
