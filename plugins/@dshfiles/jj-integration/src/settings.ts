import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const jjIntegrationSettings = defineSettings({
  namespace: 'jj-integration',
  schema: Schema.object({
    isolateByDefault: Schema.boolean()
      .default(false)
      .description(
        'Start new threads in their own jj workspace by default. Automatic integration scope all forces this on; the composer toggle can override it per thread.',
      ),
    autoIntegrationScope: Schema.union([
      Schema.const('none').description('Keep integration manual.'),
      Schema.const('isolated').description('Automatically integrate verified, isolated thread workspaces; new-thread isolation stays opt-in.'),
      Schema.const('all').description(
        'Automatically isolate each new thread and integrate only its verified, uniquely owned thread workspace; existing shared checkouts stay manual.',
      ),
    ])
      .default('none')
      .description(
        'Automatically rebase finished thread work after Project Checks pass. All scope also isolates new threads by default; existing shared checkouts stay manual.',
      ),
    bookmark: Schema.string().default('main').description('Exact local bookmark new threads start from and Rebase advances.'),
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

export const isolatesNewThreadsByDefault = (settings: JjIntegrationSettings): boolean => settings.isolateByDefault || settings.autoIntegrationScope === 'all'

export const mayAutoIntegrateWorkspace = (input: {
  readonly scope: JjIntegrationSettings['autoIntegrationScope']
  readonly isThreadWorkspace: boolean
  readonly sessionId: string
  readonly sessionIds: readonly string[]
}): boolean => input.scope !== 'none' && input.isThreadWorkspace && input.sessionIds.length === 1 && input.sessionIds[0] === input.sessionId
