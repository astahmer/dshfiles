import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const jjIntegrationSettings = defineSettings({
  namespace: 'jj-integration',
  schema: Schema.object({
    isolateByDefault: Schema.boolean()
      .default(false)
      .description('Start new threads in a jj repository in their own jj workspace. The workspace toggle above a new thread’s composer overrides it per thread.'),
    bookmark: Schema.string().default('main').description('Bookmark new threads start from and Land advances.'),
    threadsDirectory: Schema.string()
      .default('')
      .description('Parent directory for thread workspaces. Empty uses `<repository>-threads` beside the repository.'),
    setupCommand: Schema.string()
      .default('')
      .description('Shell command run in a new thread workspace right after it is created, e.g. `pnpm install --frozen-lockfile`. Empty runs nothing.'),
    askAgentToFixLanding: Schema.boolean()
      .default(true)
      .description('When Land finds conflicts or undescribed revisions, queue a message asking the thread’s agent to fix them and land again.'),
    removeFinishedThreads: Schema.boolean()
      .default(true)
      .description('Remove a thread workspace once all its threads are archived and it holds no unlanded work. Work is never deleted.'),
  }),
})

export type JjIntegrationSettings = SettingsValue<typeof jjIntegrationSettings.schema>
