import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const jjIntegrationSettings = defineSettings({
  namespace: 'jj-integration',
  schema: Schema.object({
    isolateByDefault: Schema.boolean()
      .default(false)
      .description(
        'Start new threads in their own jj workspace (the composer toggle overrides it per thread).',
      ),
    autoIntegrationScope: Schema.union([
      Schema.const('none').description('Keep landing manual.'),
      Schema.const('isolated').description('Land verified, isolated thread workspaces automatically (new threads are isolated only when asked).'),
      Schema.const('all').description(
        'Isolate each new thread and land its verified workspace automatically (shared checkouts stay manual).',
      ),
    ])
      .default('none')
      .description(
        'Land finished thread work automatically once Project Checks pass.',
      ),
    autoIntegrationExcludedRepositories: Schema.array(Schema.string())
      .default([])
      .description(
        'Repositories, by absolute path, whose work never lands automatically (manual Land still works).',
      ),
    integratedThreadActions: Schema.union([
      Schema.const('settle').description('Done: offer only Done in the “Landed on …” notice.'),
      Schema.const('archive').description('Archive: offer only Archive, the notice’s original action.'),
      Schema.const('both').description('Both: offer Done and Archive.'),
      Schema.const('none').description('None: offer no button; act on the thread row instead.'),
    ])
      .default('settle')
      .description('Buttons the “Landed on …” notice offers. The thread list’s automatic done and archive settings do it without a click.'),
    bookmark: Schema.string()
      .default('main')
      .description(
        'Fallback main branch for projects that set none and whose origin names no default.',
      ),
    repositoryBookmarks: Schema.array(
      Schema.object({
        repository: Schema.string().description('Absolute repository root.'),
        bookmark: Schema.string().description('Main branch of that repository.'),
      }),
    )
      .default([])
      .description(
        'Main branch per project, set in Settings › Projects.',
      ),
    threadsDirectory: Schema.string()
      .default('')
      .description('Parent directory for thread workspaces. Empty uses `<repository>-threads` beside the repository.'),
    askAgentToFixLanding: Schema.boolean()
      .default(true)
      .description('When Land finds conflicts or undescribed revisions, queue a message asking the thread’s agent to fix them and land again.'),
    syncWorkspaceAfterLand: Schema.string()
      .default('default')
      .description(
        'After Land, move the workspace running DSH onto the new bookmark (empty turns it off).',
      ),
    updateCheckout: Schema.string()
      .default('')
      .description(
        'Folder of the jj checkout DSH runs from, for Update DSH (empty uses this plugin’s checkout).',
      ),
    removeFinishedThreads: Schema.boolean()
      .default(true)
      .description('Automatically remove landed thread workspaces once all their threads are archived and they hold no unlanded revisions.'),
    removeFinishedThreadsAfterMinutes: Schema.natural()
      .min(1)
      .max(24 * 60)
      .default(15)
      .description('Minutes after the latest rebase to retain an inactive, finished thread workspace before removing it.'),
    stopWorkspaceProcesses: Schema.boolean()
      .default(true)
      .description(
        'Stop processes still running inside a thread workspace before cleanup removes it (your own shells are kept).',
      ),
    stopProjectActionsOnSettle: Schema.boolean()
      .default(false)
      .description('When a thread is marked done, stop its queued or running Project Checks actions, such as a dev server.'),
    autoCleanup: Schema.object({
      enabled: Schema.boolean().default(true).description('Run “Clean up thread workspaces” on its own, on the interval below.'),
      kinds: Schema.array(
        Schema.union([
          Schema.const('empty').description('Empty: workspaces that never landed anything.'),
          Schema.const('integrated').description('Landed: workspaces whose work all landed.'),
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
          'Only clean repositories that changed in this many hours (0 covers all).',
        ),
      onSettle: Schema.boolean()
        .default(false)
        .description(
          'Also remove a thread workspace as soon as its last thread is done or archived.',
        ),
    }).description(
      [
        'Remove idle thread workspaces automatically, through the same cleanup job as the manual button.',
        'Protection tiers, strongest first: revisions that are not on the bookmark and not held by another bookmark; a thread that is running, asks a question or cannot be read; an integration queued for the workspace; a secondary checkout with uncommitted or unverifiable state; and any workspace used more recently than the age above.',
        'Merged pull requests are a manual choice only: they need the pull-request links read, which an automatic run never does.',
      ].join(' '),
    ),
    autoFetch: Schema.object({
      enabled: Schema.boolean().default(false).description('Run `jj git fetch` in every registered jj repository on the interval below.'),
      intervalMinutes: Schema.natural()
        .min(5)
        .max(24 * 60)
        .default(30)
        .description('Minutes between fetches. The first one waits a couple of minutes after DSH starts.'),
      remote: Schema.string().default('origin').description('Git remote to fetch. Repositories without it are skipped.'),
      fastForwardBookmark: Schema.boolean()
        .default(false)
        .description(
          'After fetching, fast-forward the local bookmark to its remote copy (local commits are never moved).',
        ),
    }).description('Keep remote bookmarks such as main@origin fresh. Failures appear in the activity timeline.'),
  }),
})

export type JjIntegrationSettings = SettingsValue<typeof jjIntegrationSettings.schema>

/** Schema defaults, for surfaces that render before the Settings namespace loads. */
export const defaultJjIntegrationSettings: JjIntegrationSettings = jjIntegrationSettings.schema({})

export type IntegratedNoticeAction = 'settle' | 'archive'

/** The actions the “Landed on …” notice offers; marking done and archiving automatically are sidebar settings. */
export class IntegratedNoticeActions {
  static readonly forSettings = (settings: JjIntegrationSettings): readonly IntegratedNoticeAction[] => {
    if (settings.integratedThreadActions === 'both') return ['settle', 'archive']
    return settings.integratedThreadActions === 'none' ? [] : [settings.integratedThreadActions]
  }
}

export const isolatesNewThreadsByDefault = (settings: JjIntegrationSettings): boolean => settings.isolateByDefault || settings.autoIntegrationScope === 'all'

export type RepositoryBookmarkEntry = JjIntegrationSettings['repositoryBookmarks'][number]

/** Which layer decided a project's main branch, strongest first. */
export type ProjectBookmarkSource = 'project' | 'file' | 'detected' | 'global'

/** A project's main branch and the layer that chose it. */
export interface ProjectBookmarkChoice {
  readonly bookmark: string
  readonly source: ProjectBookmarkSource
}

/** Repository paths differ only by a trailing separator when a person typed them. */
const comparablePath = (path: string): string => path.trim().replace(/[\\/]+$/u, '')

/** A bookmark name a person or a repository wrote: one non-empty token jj and git both accept as a name. */
const usableBookmarkName = (name: string | null | undefined): string | null => {
  const trimmed = name?.trim() ?? ''
  return trimmed.length === 0 ||
    trimmed.length > 200 ||
    trimmed.startsWith('-') ||
    trimmed.startsWith('/') ||
    trimmed.includes('..') ||
    /[\s"'`\\]/u.test(trimmed)
    ? null
    : trimmed
}

/**
 * The per-project main branch: the profile override, else the repository's `dsh.project.json`, else the branch origin
 * marks as default, else the global setting. Paths compare without a trailing separator, like the auto-integration
 * opt-out.
 */
export class RepositoryBookmarks {
  static readonly usableName = usableBookmarkName

  static readonly overrideFor = (input: { readonly repositoryRoot: string; readonly entries: readonly RepositoryBookmarkEntry[] }): string | null => {
    const repository = comparablePath(input.repositoryRoot)
    const entry = input.entries.findLast(candidate => comparablePath(candidate.repository) === repository)
    return usableBookmarkName(entry?.bookmark)
  }

  /** The entries with this repository's override replaced, or removed when `bookmark` is null or unusable. */
  static readonly withOverride = (input: {
    readonly entries: readonly RepositoryBookmarkEntry[]
    readonly repositoryRoot: string
    readonly bookmark: string | null
  }): RepositoryBookmarkEntry[] => {
    const repository = comparablePath(input.repositoryRoot)
    const others = input.entries.filter(entry => comparablePath(entry.repository) !== repository)
    const bookmark = usableBookmarkName(input.bookmark)
    return bookmark === null ? others : [...others, { repository, bookmark }]
  }

  static readonly resolve = (input: {
    readonly override: string | null
    readonly declared: string | null | undefined
    readonly detected: string | null
    readonly fallback: string
  }): ProjectBookmarkChoice => {
    const override = usableBookmarkName(input.override)
    if (override !== null) return { bookmark: override, source: 'project' }
    const declared = usableBookmarkName(input.declared)
    if (declared !== null) return { bookmark: declared, source: 'file' }
    const detected = usableBookmarkName(input.detected)
    if (detected !== null) return { bookmark: detected, source: 'detected' }
    return { bookmark: input.fallback, source: 'global' }
  }
}

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
