import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const jjIntegrationSettings = defineSettings({
  namespace: 'jj-integration',
  schema: Schema.object({
    isolateByDefault: Schema.boolean()
      .default(false)
      .description(
        'Start new threads in a jj repository in their own jj workspace. The workspace toggle above a new thread’s composer overrides it per thread.',
      ),
    bookmark: Schema.string().default('main').description('Bookmark new threads start from and Rebase advances.'),
    threadsDirectory: Schema.string()
      .default('')
      .description('Parent directory for thread workspaces. Empty uses `<repository>-threads` beside the repository.'),
    askAgentToFixLanding: Schema.boolean()
      .default(true)
      .description('When Rebase finds conflicts or undescribed revisions, queue a message asking the thread’s agent to fix them and rebase again.'),
    syncWorkspaceAfterLand: Schema.string()
      .default('default')
      .description(
        'After Rebase advances the bookmark, bring this jj workspace (the checkout running DSH) onto it in the background with `dshx checkout sync`, keeping its local edits and rebuilding what changed. Empty disables it.',
      ),
    removeFinishedThreads: Schema.boolean()
      .default(true)
      .description('Remove a thread workspace once all its threads are archived and it holds no revisions to rebase. Work is never deleted.'),
  }),
})

export type JjIntegrationSettings = SettingsValue<typeof jjIntegrationSettings.schema>
