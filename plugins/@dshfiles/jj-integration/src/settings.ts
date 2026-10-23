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
    autoIntegrationExcludedRepositories: Schema.array(Schema.string())
      .default([])
      .description(
        'Repositories whose finished thread work is never integrated automatically, such as a checkout whose main only accepts pull requests. Manual Integrate still works. Each value is the absolute repository path shown beside the project in Thread integration.',
      ),
    integratedThreadActions: Schema.union([
      Schema.const('settle').description('Settle: offer only Settle in the “Integrated into …” notice.'),
      Schema.const('archive').description('Archive: offer only Archive, the notice’s original action.'),
      Schema.const('both').description('Both: offer Settle and Archive.'),
      Schema.const('none').description('None: offer no button; act on the thread row instead.'),
    ])
      .default('settle')
      .description(
        'Buttons the “Integrated into …” notice offers. “Settle integrated threads” and “Archive settled threads” in Thread sidebar settings do it automatically instead.',
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
      .description('Automatically remove rebased thread workspaces once all their threads are archived and they hold no revisions to rebase.'),
    removeFinishedThreadsAfterMinutes: Schema.natural()
      .min(1)
      .max(24 * 60)
      .default(15)
      .description('Minutes after the latest rebase to retain an inactive, finished thread workspace before removing it.'),
    autoCleanup: Schema.object({
      enabled: Schema.boolean().default(true).description('Run “Clean up thread workspaces” on its own, on the interval below.'),
      kinds: Schema.array(
        Schema.union([
          Schema.const('empty').description('Empty: workspaces that never landed anything.'),
          Schema.const('integrated').description('Integrated: workspaces whose work all landed.'),
          Schema.const('untracked').description('Untracked: threads-directory folders and files no jj workspace owns.'),
        ]),
      )
        .default(['empty', 'integrated'])
        .description('Which idle thread workspaces the automatic run removes. Untracked is opt-in. An empty list removes nothing.'),
      olderThanHours: Schema.natural()
        .min(1)
        .max(24 * 90)
        .default(24)
        .description('Only workspaces last used longer ago than this many hours.'),
      intervalMinutes: Schema.natural()
        .min(5)
        .max(24 * 60)
        .default(60)
        .description('Minutes between automatic runs. The first run waits a few minutes after DSH starts.'),
      activeWithinHours: Schema.natural()
        .min(0)
        .max(24 * 7)
        .default(2)
        .description(
          'Only repositories whose checkout or one of whose thread workspaces changed in this many hours. 0 covers every registered repository, like the manual button.',
        ),
    }).description(
      'Remove idle thread workspaces automatically, through the same cleanup job as the manual button. A workspace with unlanded revisions, a working or waiting thread, a thread whose activity cannot be read, or a queued integration is always kept.',
    ),
  }),
})

export type JjIntegrationSettings = SettingsValue<typeof jjIntegrationSettings.schema>

/** Schema defaults, for surfaces that render before the Settings namespace loads. */
export const defaultJjIntegrationSettings: JjIntegrationSettings = jjIntegrationSettings.schema({})

export type IntegratedNoticeAction = 'settle' | 'archive'

/** The actions the “Integrated into …” notice offers; settling and archiving automatically are sidebar settings. */
export class IntegratedNoticeActions {
  static readonly forSettings = (settings: JjIntegrationSettings): readonly IntegratedNoticeAction[] => {
    if (settings.integratedThreadActions === 'both') return ['settle', 'archive']
    return settings.integratedThreadActions === 'none' ? [] : [settings.integratedThreadActions]
  }
}

export const isolatesNewThreadsByDefault = (settings: JjIntegrationSettings): boolean => settings.isolateByDefault || settings.autoIntegrationScope === 'all'

/** Repository-level opt-out from automatic integration, matched on the repository root the Host reports. */
export class RepositoryAutoIntegration {
  /** Repository paths differ only by a trailing separator when a person typed them. */
  static readonly isExcluded = (input: { readonly repositoryRoot: string; readonly excludedRepositoryRoots: readonly string[] }): boolean => {
    const repository = RepositoryAutoIntegration.comparablePath(input.repositoryRoot)
    return input.excludedRepositoryRoots.some(excluded => RepositoryAutoIntegration.comparablePath(excluded) === repository)
  }

  private static readonly comparablePath = (path: string): string => path.trim().replace(/[\\/]+$/u, '')
}

export const mayAutoIntegrateWorkspace = (input: {
  readonly scope: JjIntegrationSettings['autoIntegrationScope']
  readonly isThreadWorkspace: boolean
  readonly sessionId: string
  readonly sessionIds: readonly string[]
  readonly repositoryRoot: string
  readonly excludedRepositoryRoots: readonly string[]
}): boolean =>
  input.scope !== 'none' &&
  input.isThreadWorkspace &&
  input.sessionIds.length === 1 &&
  input.sessionIds[0] === input.sessionId &&
  !RepositoryAutoIntegration.isExcluded(input)
