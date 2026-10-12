import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

/** Tools a read-only observer may run in a workspace it does not own. */
export const DEFAULT_READ_ONLY_TOOLS = [
  'read',
  'read_image',
  'glob',
  'grep',
  'web_search',
  'web_fetch',
  'todo_write',
  'jj_workspace_list',
  'jj_workspace_inspect',
  'jj_integration_list',
  'jj_integration_inspect',
  'jj_integration_events',
] as const

/**
 * Every option lives in one settings namespace, because a Host entry cannot
 * declare native `Config` and dshx settings together (DSHX2002). The two
 * automation modes are applied live; the rest is read when the plugin activates.
 */
export const jjIntegrationSettings = defineSettings({
  namespace: 'jj-integration',
  schema: Schema.object({
    spineBookmark: Schema.string().default('integration-spine').description('Bookmark or commit every integration advances.'),
    validationCommand: Schema.string().default('').description('Command run in the staging workspace before the spine advances. Empty disables validation.'),
    allowAnyAgentIntegration: Schema.boolean()
      .default(false)
      .description('Let any Session run a coordinator integration, not only the coordinator sessions below.'),
    coordinatorSessions: Schema.array(Schema.string()).default([]).description('Sessions allowed to run and advance integration.'),
    autoDiscoverWorkspaces: Schema.boolean()
      .default(true)
      .description('Register the checkout a Session starts in, so existing sessions keep working without being migrated.'),
    workspaceIsolationMode: Schema.union([
      Schema.const('auto').description('New coding threads get their own jj workspace automatically.'),
      Schema.const('manual').description('A new coding thread keeps the checkout it was started in until a workspace is chosen.'),
      Schema.const('off').description('No workspace is provisioned for new coding threads.'),
    ])
      .default('auto')
      .description('Automatic thread-to-workspace isolation. A provisioning failure refuses the Session; it never falls back to the shared checkout.'),
    workspaceIsolationDirectory: Schema.string()
      .default('')
      .description('Parent directory for thread workspaces. Empty uses a sibling of the repository root.'),
    integrationMode: Schema.union([
      Schema.const('auto').description('A workspace marked ready integrates immediately.'),
      Schema.const('manual').description('A workspace integrates only when you request it.'),
      Schema.const('off').description('Integration actions are refused; ownership enforcement and the jj guard stay on.'),
    ])
      .default('manual')
      .description('Coordinator-driven integration. Only the explicit ready signal queues work; a finished turn never does.'),
    staleAfterSeconds: Schema.natural()
      .min(30)
      .max(86_400)
      .default(900)
      .description('Seconds a writer lease may stay quiet before another Session may reclaim it. The previous holder is fenced.'),
    readOnlyTools: Schema.array(Schema.string())
      .default([...DEFAULT_READ_ONLY_TOOLS])
      .description('Tools a read-only observer may run in a workspace it does not own.'),
    protectedPaths: Schema.array(Schema.string())
      .default(['~/.dsh-lkg'])
      .description(
        'Paths no tool call may name, whatever the tool and whichever workspace it runs in. This is the last known good recovery store: it must outlive the failure it exists for, so a DSH Session cannot rewrite, launch, promote or delete it. Empty disables the guard.',
      ),
    /**
     * Cleanup is separate from integration automation on purpose: turning one off
     * never changes the other, and neither disables ownership enforcement.
     */
    workspaceCleanup: Schema.object({
      enabled: Schema.boolean()
        .default(true)
        .description(
          'Consider provisioned thread workspaces for automatic cleanup. Pinned, leased, attached, uncommitted and unintegrated workspaces are never removed.',
        ),
      idleAfterDays: Schema.natural().min(0).max(3_650).default(1).description('Days without meaningful activity before a workspace is reported idle.'),
      deleteAfterDays: Schema.natural()
        .min(0)
        .max(3_650)
        .default(7)
        .description('Days without meaningful activity before an idle workspace becomes eligible for cleanup.'),
      dryRun: Schema.boolean().default(false).description('Report what cleanup would remove and remove nothing. Manual cleanup can also be run as a dry run.'),
    })
      .default({ enabled: true, idleAfterDays: 1, deleteAfterDays: 7, dryRun: false })
      .description(
        'Automatic removal of idle thread workspaces. It removes a registration and a disposable directory only: no revision is abandoned and no bookmark moves.',
      ),
  }),
})

export type JjIntegrationSettings = SettingsValue<typeof jjIntegrationSettings.schema>
