import { defineApi, method } from '@dshfiles/dshx/api'
import { jjRepositoriesSchema, jjRepositorySchema, jjRevisionSchema, jjThreadSchema } from '@dshfiles/multi-host/api'
import { z } from 'zod'
import { CleanupJobModel } from './cleanup-jobs.js'

export type ThreadRevisionView = z.infer<typeof jjRevisionSchema>
export type ThreadView = z.infer<typeof jjThreadSchema>
export type RepositoryView = z.infer<typeof jjRepositorySchema>

const integrationProgressSchema = z.object({ phase: z.enum(['queued', 'validating', 'rebasing']), updatedAt: z.number().int().nonnegative() }).strict()

const landResultSchema = z
  .object({
    status: z.enum(['landed', 'nothing-to-land', 'needs-description', 'conflicted']),
    revisions: z.array(jjRevisionSchema),
    files: z.array(z.string()),
    bookmark: z.string(),
    /** Where the bookmark points after rebasing; absent from a Host older than this field. */
    head: jjRevisionSchema.optional(),
    agentAsked: z.boolean(),
  })
  .strict()
export type LandResult = z.infer<typeof landResultSchema>

const workspaceSyncSchema = z
  .object({
    state: z.enum(['running', 'done', 'failed']),
    workspace: z.string(),
    bookmark: z.string(),
    /** `dshx checkout sync`'s status once it finished; null while running or when it could not run. */
    status: z.enum(['up-to-date', 'synced', 'would-sync', 'refused', 'conflicted', 'build-failed']).nullable(),
    pluginsRebuilt: z.array(z.string()),
    /** Rebuilt plugins whose only change was their client bundle, which DSH hot-reloads. */
    hotPlugins: z.array(z.string()),
    restartNeeded: z.boolean(),
    conflicts: z.array(z.string()),
    /** What to do when the sync stopped: the routine's hint or error. */
    message: z.string().nullable(),
    finishedAt: z.string().nullable(),
  })
  .strict()
export type WorkspaceSyncView = z.infer<typeof workspaceSyncSchema>

const destinationSchema = z
  .object({
    /** Whether the workspace is in a jj repository at all; bookmarks and isolation need one. */
    vcs: z.enum(['jj', 'none']),
    isolated: z.boolean(),
    /** The repository checkout a thread workspace belongs to, so the folder picker shows the project, not the thread. */
    projectWorkspaceId: z.string().nullable(),
    bookmark: z.string().nullable(),
    bookmarks: z.array(z.string()),
    isolateByDefault: z.boolean(),
    ownedByAnotherSession: z.boolean().optional(),
  })
  .strict()
export type DestinationView = z.infer<typeof destinationSchema>

export const threadWorkspaceName = z.string().regex(/^thread-[0-9a-f]{6}$/u)

const isolatedWorkspaceSchema = z.object({ name: z.string().min(1), path: z.string().min(1), created: z.boolean() }).strict()

const threadPathInput = z
  .object({
    path: z.string().min(1).optional().describe('Thread workspace path; defaults to this Session’s working directory or its on-demand isolated workspace.'),
  })
  .strict()

const cleanupKindSchema = z.enum(['empty', 'integrated', 'secondary', 'untracked'])
const cleanupTargetSchema = z.object({ repoRoot: z.string().min(1), name: z.string().min(1), kind: cleanupKindSchema }).strict()

const cleanupWorkspaceSchema = z
  .object({
    repoRoot: z.string(),
    name: z.string(),
    path: z.string(),
    kind: z.enum(['empty', 'integrated', 'secondary']),
    lastUsedAt: z.number().int().nonnegative(),
    missing: z.boolean(),
    outcome: z.enum(['would-remove', 'removed', 'has-work', 'failed']),
    message: z.string().max(400).optional(),
  })
  .strict()

const cleanupSkippedSchema = z
  .object({
    repoRoot: z.string(),
    name: z.string(),
    reason: z.enum(['has-work', 'busy', 'activity-unknown', 'queued', 'too-recent', 'kind-excluded', 'working-copy-dirty', 'workspace-state-unknown']),
  })
  .strict()

const cleanupUntrackedSchema = z
  .object({
    repoRoot: z.string(),
    name: z.string(),
    path: z.string(),
    modifiedAt: z.number().int().nonnegative(),
    outcome: z.enum(['would-remove', 'removed', 'failed']),
    message: z.string().max(400).optional(),
  })
  .strict()

const cleanupResultSchema = z
  .object({
    applied: z.boolean(),
    workspaces: z.array(cleanupWorkspaceSchema),
    skipped: z.array(cleanupSkippedSchema),
    /** Threads-directory folders and files no jj workspace owns, such as forgotten workspaces and stray logs. */
    untracked: z.array(cleanupUntrackedSchema),
    /** Empty, undescribed revisions nothing builds on, found (and abandoned when applied) after the workspaces went. */
    emptyRevisions: z.array(jjRevisionSchema),
  })
  .strict()
export type CleanupResult = z.infer<typeof cleanupResultSchema>
export type CleanupKindView = z.infer<typeof cleanupKindSchema>
export type CleanupTarget = z.infer<typeof cleanupTargetSchema>

const cleanupJobSchema = z
  .object({
    id: z.string().min(1).max(64),
    /** `queued` waits behind the job that runs; a Host restart drops the trail with the job. */
    state: z.enum(['queued', 'running', 'done', 'failed']),
    phase: z.enum(['queued', 'scanning', 'removing', 'abandoning', 'done', 'failed']),
    request: z
      .object({
        path: z.string().nullable(),
        olderThanHours: z.number().int().nonnegative(),
        kinds: z.array(cleanupKindSchema),
        targets: z.array(cleanupTargetSchema).max(500).optional(),
        /** `automatic` is the Host's interval run (setting autoCleanup); a Host from before it omits the field. */
        trigger: z.enum(['manual', 'automatic']).optional(),
      })
      .strict(),
    startedAt: z.number().int().nonnegative(),
    finishedAt: z.number().int().nonnegative().nullable(),
    progress: z
      .object({
        /** Workspaces and untracked folders the scan decided to remove; empty revisions settle only at the end. */
        total: z.number().int().nonnegative(),
        processed: z.number().int().nonnegative(),
        removed: z.number().int().nonnegative(),
        kept: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        current: z.string().max(400).nullable(),
      })
      .strict(),
    error: z.string().max(400).nullable(),
    /** Only the newest job carries its rows, so a poll of the whole trail stays small. */
    result: cleanupResultSchema.nullable(),
  })
  .strict()
export type CleanupJobView = z.infer<typeof cleanupJobSchema>

const cleanupRequestSchema = z
  .object({
    /** Any folder inside the repository; omit to clean every registered jj repository. */
    path: z.string().min(1).optional(),
    olderThanHours: z
      .number()
      .int()
      .min(0)
      .max(24 * 90),
    kinds: z.array(cleanupKindSchema).min(1).max(4),
    /** When present, the removal pass is narrowed to these preview rows. */
    targets: z.array(cleanupTargetSchema).max(500).optional(),
  })
  .strict()

const renderCleanup = (output: CleanupResult): string => {
  const verb = output.applied ? 'Removed' : 'Would remove'
  const removed = output.workspaces.filter(workspace => workspace.outcome === 'removed' || workspace.outcome === 'would-remove')
  const refused = output.workspaces.filter(workspace => workspace.outcome === 'has-work' || workspace.outcome === 'failed')
  return [
    `${verb} ${String(removed.length)} workspace(s)${removed.length === 0 ? '' : `: ${removed.map(workspace => `${workspace.name} (${workspace.missing ? 'folder missing; registration forgotten' : workspace.kind})`).join(', ')}`}.`,
    refused.length === 0 ? undefined : `Kept ${refused.map(workspace => `${workspace.name} (${workspace.message ?? workspace.outcome})`).join(', ')}.`,
    output.untracked.length === 0
      ? undefined
      : `${verb} ${String(output.untracked.length)} untracked entr(ies): ${output.untracked.map(entry => (entry.outcome === 'failed' ? `${entry.name} (failed)` : entry.name)).join(', ')}.`,
    `${output.applied ? 'Abandoned' : 'Would abandon'} ${String(output.emptyRevisions.length)} dangling empty revision(s).`,
    CleanupJobModel.skippedSummary(output),
  ]
    .filter(line => line !== undefined)
    .join('\n')
}

const registeredProjectSchema = z.object({ workspaceId: z.string(), title: z.string(), path: z.string() }).strict()

export const jjIntegrationApi = defineApi({
  id: 'jj-threads',
  version: 1,
  owner: '@dshfiles/jj-integration',
  methods: {
    ownWorkspaceFor: method({
      input: z.object({ workspaceId: z.string().min(1) }).strict(),
      output: z.object({ workspaceId: z.string(), branched: z.boolean() }).strict(),
      description:
        'Where a new thread may start: the given workspace, unless it is a jj thread workspace another thread already uses; then a fresh thread workspace starting from its latest revision.',
    }),
    provision: method({
      input: z
        .object({
          workspaceId: z.string().min(1),
          isolate: z.boolean().optional(),
          base: z.string().min(1).max(256).optional(),
          /** Chosen by the client so it can show the thread workspace before the Host created it. */
          name: threadWorkspaceName.optional(),
        })
        .strict(),
      // A Host from before the destination field omits it; the client then reads the destination itself.
      output: z.object({ workspaceId: z.string(), isolated: z.boolean(), destination: destinationSchema.optional() }).strict(),
    }),
    destination: method({
      input: z.object({ workspaceId: z.string().min(1), sessionId: z.string().min(1).optional() }).strict(),
      output: destinationSchema,
      description:
        'The jj destination of one project or thread workspace: whether it is in a jj repository, whether it is an isolated thread workspace, its owning project, the target bookmark and every available bookmark. Read-only.',
      tool: {
        name: 'jj_thread_destination',
        readOnly: true,
        render: output =>
          [
            output.vcs === 'jj' ? 'Jujutsu repository' : 'No jj repository',
            output.isolated ? 'isolated thread workspace' : undefined,
            `bookmark ${output.bookmark ?? 'none'}`,
            output.bookmarks.length === 0 ? undefined : `available: ${output.bookmarks.join(', ')}`,
            output.ownedByAnotherSession === true ? 'owned by another thread' : undefined,
          ]
            .filter(part => part !== undefined)
            .join(' · '),
      },
    }),
    classifyWorkspaces: method({
      input: z.object({ workspaceIds: z.array(z.string().min(1).max(256)).max(256) }).strict(),
      output: z.object({ jjWorkspaceIds: z.array(z.string().min(1).max(256)).max(256) }).strict(),
      description: 'Return registered workspace IDs that are confirmed secondary workspaces in an owning JJ repository.',
    }),
    projects: method({
      input: z.object({}).strict(),
      output: z
        .object({
          projects: z.array(registeredProjectSchema),
          /** Existing thread workspaces, listed apart; a Host from before this field omits it. */
          workspaces: z.array(registeredProjectSchema).optional(),
        })
        .strict(),
      description:
        'List registered projects (DSH Workspaces) that are real checkouts rather than thread workspaces, with their workspace id, title and path; folders that no longer exist are left out. Read-only.',
      tool: {
        name: 'jj_thread_projects',
        readOnly: true,
        render: output => output.projects.map(project => `${project.workspaceId} · ${project.title} · ${project.path}`).join('\n') || 'No registered projects.',
      },
    }),
    noFolder: method({ input: z.object({}).strict(), output: z.object({ workspaceId: z.string() }).strict() }),
    repositories: method({
      input: z.object({}).strict(),
      output: jjRepositoriesSchema,
      description:
        'List jj repositories and their thread workspaces: each thread workspace’s name, path, owning Sessions, finished state, pending revisions, how far behind the bookmark it is, and whether it can be integrated right now. The view may be stale while a refresh runs; read-only.',
      tool: {
        name: 'jj_thread_repositories',
        readOnly: true,
        render: output => {
          const content = output.repositories
            .map(repository =>
              [
                `${repository.title} (${repository.repoRoot})${repository.workspaceId === null ? '' : ` · project ${repository.workspaceId}`}`,
                ...repository.threads.map(thread => {
                  const flags = [
                    thread.finished ? 'finished' : undefined,
                    thread.missing ? 'missing workspace' : undefined,
                    thread.canRebase === true ? 'can rebase' : thread.canRebase === false ? 'blocked' : 'activity unknown',
                    thread.unlanded.length === 0 ? 'no pending revisions' : `${String(thread.unlanded.length)} pending`,
                    (thread.behindCount ?? (thread.behind ? 1 : 0)) === 0 ? undefined : `${String(thread.behindCount ?? 1)} behind`,
                  ].filter(flag => flag !== undefined)
                  return `  ${thread.name} · ${thread.path}${thread.sessionIds.length === 0 ? '' : ` · ${thread.sessionIds.join(', ')}`}${flags.length === 0 ? '' : ` · ${flags.join(' · ')}`}`
                }),
              ].join('\n'),
            )
            .join('\n')
          if (content.length > 0) {
            const note =
              output.refreshing === true
                ? 'A repository scan is running; listed statuses may be stale.'
                : output.refreshFailed === true
                  ? 'The last repository scan failed; listed statuses may be stale.'
                  : undefined
            return note === undefined ? content : `${note}\n${content}`
          }
          if (output.refreshing === true) return 'Repository scan is running; no cached results are available yet.'
          if (output.refreshFailed === true) return 'Repository scan failed; no cached results are available.'
          return 'No jj repositories with thread workspaces.'
        },
      },
    }),
    refreshRepositories: method({
      input: z.object({}).strict(),
      output: z.object({ started: z.boolean() }).strict(),
      description:
        'Start a fresh jj repository and thread-status scan in the background. Returns immediately; read the repositories view for progress and results.',
      tool: {
        name: 'jj_thread_refresh_repositories',
        readOnly: true,
        render: output => (output.started ? 'Repository status scan started.' : 'A repository status scan is already running.'),
      },
    }),
    threadAt: method({
      input: z
        .object({
          path: z.string().min(1),
          /** The reading Session, so integration notices stay inside its own conversation; an older Host rejects it. */
          sessionId: z.string().min(1).max(128).optional(),
        })
        .strict(),
      output: z.object({ thread: jjThreadSchema.nullable() }).strict(),
      description:
        'The thread workspace at a path (revisions not yet on the bookmark, conflicts, whether main moved, and whether it is safe to rebase), or null when the path is not a thread.',
    }),
    revisionGraph: method({
      input: z.object({ path: z.string().min(1) }).strict(),
      output: z.object({ graph: z.string().max(16_000) }).strict(),
      description: 'A bounded jj revision graph for the thread, configured bookmark, origin bookmark, and default workspace.',
    }),
    isolate: method({
      input: z.object({}).strict(),
      output: isolatedWorkspaceSchema,
      description:
        'Before the first code edit, call when this task needs code changes and the current Session is not already in a dedicated thread workspace. Creates one from the configured bookmark, independently of local checkout commits. The Session cwd does not change: use the returned absolute path for every subsequent file operation and shell workdir. Relative @ file references still resolve against the original Session cwd; use absolute thread-workspace paths for file references. No commit or rebase occurs.',
      tool: {
        name: 'jj_thread_isolate',
        render: output =>
          `${output.created ? 'Created' : 'Already in'} isolated jj workspace ${output.name} at ${output.path}. Use that absolute path for all subsequent file operations and shell workdir. Relative @ file references still resolve against the original Session cwd; use absolute thread-workspace paths for references. Thread status and rebase tools will target this workspace automatically.`,
      },
    }),
    land: method({
      input: z.object({ path: z.string().min(1), sessionId: z.string().optional(), bookmark: z.string().min(1).optional() }).strict(),
      output: landResultSchema,
      description:
        'Rebase the thread at a path: move its described revisions onto the selected bookmark (the configured bookmark by default) and advance it. Never pushes. Refuses while any Session working in that jj workspace is running or waiting for input, and names them; the calling agent may rebase its own thread once it resolved a handed-back problem.',
    }),
    queueLand: method({
      input: z.object({ path: z.string().min(1), sessionId: z.string().optional() }).strict(),
      output: z.object({ queuedAt: z.number().int().nonnegative() }).strict(),
      description:
        'Queue an integration of the thread at a path that runs as soon as every Session working in that jj workspace is idle and no question waits. The rebase itself keeps every guard of `land`; cancelQueuedLand undoes the request until it starts.',
    }),
    cancelQueuedLand: method({
      input: z.object({ path: z.string().min(1) }).strict(),
      output: z.object({ status: z.enum(['cancelled', 'not-queued', 'integrating']) }).strict(),
      description: 'Cancel a queued integration. Refused with `integrating` once its rebase has started.',
    }),
    integrationProgress: method({
      input: z.object({ path: z.string().min(1) }).strict(),
      output: z.object({ progress: integrationProgressSchema.nullable() }).strict(),
      description: 'Read the current phase of a UI-triggered thread integration operation.',
    }),
    reviewHistory: method({
      input: z.object({ path: z.string().min(1) }).strict(),
      output: z
        .object({
          repoRoot: z.string().min(1),
          name: threadWorkspaceName,
          integrations: z.array(
            z
              .object({
                at: z.number().int().nonnegative(),
                tipChangeId: z.string().min(1).max(128).optional(),
                baseChangeId: z.string().min(1).max(128).optional(),
                sessionId: z.string().min(1).max(128).optional(),
              })
              .strict(),
          ),
        })
        .strict(),
      description: 'Read the persistent review ranges recorded when this thread landed, even after its workspace folder was removed.',
      tool: {
        name: 'jj_thread_review_history',
        readOnly: true,
        render: output =>
          output.integrations
            .filter(record => record.baseChangeId !== undefined && record.tipChangeId !== undefined)
            .map(record => `${record.baseChangeId}..${record.tipChangeId} · ${new Date(record.at).toISOString()}`)
            .join('\\n') || 'No exact saved review ranges. Older integrations may lack a stored base change ID.',
      },
    }),
    threadStatus: method({
      input: threadPathInput,
      output: z.object({ bookmark: z.string(), thread: jjThreadSchema.nullable() }).strict(),
      description:
        'Show this thread’s jj workspace: its revisions not yet on the target bookmark (main by default), conflicts, whether the bookmark moved since its last rebase, and whether it is safe to rebase now. Read-only.',
      tool: {
        name: 'jj_thread_status',
        readOnly: true,
        render: output =>
          output.thread === null
            ? 'This Session does not run in a thread workspace; it works directly in the repository checkout.'
            : JSON.stringify({ bookmark: output.bookmark, ...output.thread }),
      },
    }),
    landThread: method({
      input: threadPathInput.extend({ bookmark: z.string().min(1).optional() }),
      output: z.object({ summary: z.string(), result: landResultSchema.nullable() }).strict(),
      description:
        'Integrate this thread’s described work into the target bookmark (main by default): rebase the thread revisions onto the current bookmark tip, then advance the bookmark to the new tip. Existing bookmark ancestry stays intact; nothing is pushed. An agent calling it for its own thread is exempt from its own running session, while every other thread session must be idle and free of pending questions. It refuses undescribed revisions and reports conflicts. Call only when the user asked to integrate this thread’s work.',
      tool: { name: 'jj_thread_rebase', render: output => output.summary },
    }),
    workspaceSync: method({
      input: z.object({}).strict(),
      output: z.object({ sync: workspaceSyncSchema.nullable() }).strict(),
      description:
        'State of the last sync of the DSH checkout onto main after a rebase: running, done or failed, which plugins were rebuilt, conflicts, and whether DSH needs a restart. Read-only.',
      tool: {
        name: 'jj_thread_workspace_sync',
        readOnly: true,
        render: output =>
          output.sync === null
            ? 'No checkout sync has run yet.'
            : [
                `checkout sync ${output.sync.state}`,
                output.sync.status === null ? undefined : output.sync.status,
                output.sync.pluginsRebuilt.length === 0 ? undefined : `rebuilt ${output.sync.pluginsRebuilt.join(', ')}`,
                output.sync.conflicts.length === 0 ? undefined : `conflicts ${output.sync.conflicts.join(', ')}`,
                output.sync.restartNeeded ? 'DSH restart needed' : 'no restart needed',
                output.sync.message ?? undefined,
              ]
                .filter(part => part !== undefined)
                .join(' · '),
      },
    }),
    discard: method({
      input: z.object({ path: z.string().min(1), force: z.boolean() }).strict(),
      output: z.object({ status: z.enum(['discarded', 'has-work']), revisions: z.array(jjRevisionSchema) }).strict(),
      description:
        'Remove one thread workspace: forget its jj workspace and its DSH project registration. Unlanded revisions are kept unless force is true, which abandons them. Call only when the user asked to remove that thread workspace.',
      tool: {
        name: 'jj_thread_discard',
        render: output =>
          output.status === 'discarded'
            ? 'Removed that thread workspace and its project registration.'
            : `Refused: ${String(output.revisions.length)} unlanded revision(s) remain (${output.revisions
                .map(revision => revision.description || revision.changeId)
                .join('; ')}). Ask the user before passing force: true.`,
      },
    }),
    discardMany: method({
      input: z.object({ paths: z.array(z.string().min(1)).min(1).max(100), force: z.boolean(), confirm: z.literal(true) }).strict(),
      output: z
        .object({
          results: z.array(
            z
              .object({
                path: z.string(),
                status: z.enum(['discarded', 'has-work', 'error']),
                revisions: z.array(jjRevisionSchema),
                error: z.string().nullable(),
              })
              .strict(),
          ),
        })
        .strict(),
      description:
        'Remove up to 100 specified thread workspaces in one request. Each target follows jj_thread_discard rules: with force false, unlanded revisions are kept; force true abandons them. Requires confirm: true as explicit opt-in, and force: true only when the user explicitly authorized abandoning unlanded work. Each target reports its own result and failures do not prevent later targets. Call only when the user asked to remove these workspaces.',
      tool: {
        name: 'jj_thread_discard_many',
        render: output =>
          output.results
            .map(result =>
              result.status === 'discarded'
                ? `Removed ${result.path}.`
                : result.status === 'has-work'
                  ? `Kept ${result.path}: ${String(result.revisions.length)} unlanded revision(s).`
                  : `Failed ${result.path}: ${result.error ?? 'unknown error'}`,
            )
            .join('\n'),
      },
    }),
    cleanupWorkspaces: method({
      input: cleanupRequestSchema.extend({ apply: z.boolean() }).strict(),
      output: cleanupResultSchema,
      description:
        'Remove idle workspaces in one pass, then abandon empty undescribed revisions nothing builds on. Thread workspaces must have no unlanded revision, no live Session working, waiting for an answer or unreadable, no queued integration, and a listed kind; they must also have been unused longer than olderThanHours (empty: never landed; integrated: landed and nothing left). Other JJ workspaces are manual-only and opt-in: present checkouts must be idle, have no queued integration, a clean and verified working copy with no unlanded work, and a reported root outside the primary checkout and threads directory. Missing secondary checkouts can only be forgotten when their root stays absent and no unlanded work or live Session remains; cleanup never deletes their path. JJ snapshots present working-copy files before checking them, preserving them in the working-copy revision. The untracked kind removes stale threads-directory entries no JJ workspace owns. When targets is present, only matching preview rows are removed. Never forces unlanded work. apply: false previews; call with apply: true only when the user asked to clean up.',
      tool: { name: 'jj_thread_cleanup', render: renderCleanup },
    }),
    startCleanup: method({
      input: cleanupRequestSchema,
      output: z.object({ job: cleanupJobSchema }).strict(),
      description:
        'Start removing idle workspaces in the background. Returns at once with the job, so a UI click never waits on node_modules deletion; cleanupJobs reports its progress and outcome, and the newest job carries the full result. The same scope already queued or running is returned instead of queued twice. Secondary JJ workspaces are manual-only and opt-in; cleanupWorkspaces documents their safety checks. Call only when the user asked to clean up.',
    }),
    cleanupJobs: method({
      input: z.object({}).strict(),
      output: z.object({ jobs: z.array(cleanupJobSchema).max(32) }).strict(),
      description:
        'Progress and recent trail of background workspace cleanup jobs, newest first: state, phase, counts, the item in flight, the failure, and the newest job’s full result. Read-only.',
      tool: {
        name: 'jj_thread_cleanup_jobs',
        readOnly: true,
        render: output =>
          output.jobs
            .map(job => {
              const progress = `${String(job.progress.processed)}/${String(job.progress.total)} processed`
              const running = job.progress.current === null ? '' : ` · removing ${job.progress.current}`
              const failure = job.error === null ? '' : ` · ${job.error}`
              const result = job.result === null ? '' : ` · ${renderCleanup(job.result).replaceAll('\n', ' · ')}`
              const trigger = job.request.trigger === 'automatic' ? ' · automatic' : ''
              return `${job.id}${trigger} · ${job.state}/${job.phase} · ${progress} · ${String(job.progress.removed)} removed, ${String(job.progress.kept)} kept, ${String(job.progress.failed)} failed${running}${failure}${result}`
            })
            .join('\n') || 'No thread-workspace removal has run.',
      },
    }),
  },
})
