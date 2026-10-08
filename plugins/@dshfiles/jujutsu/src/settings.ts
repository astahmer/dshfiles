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
    diffExpanded: Schema.boolean().default(false).description('Expand the raw patch of an opened revision by default.'),
    hideImmutable: Schema.boolean().default(false).description('Hide immutable revisions in the graph.'),
    mineOnly: Schema.boolean().default(false).description('Show only your own revisions (and the working copy) in the graph.'),
    dateHeadings: Schema.boolean().default(true).description('Group graph revisions under day headings.'),
    revisionLimit: Schema.natural().min(50).max(500).default(300).description('Revisions loaded into the graph.'),
  }),
  applies: 'live',
})
