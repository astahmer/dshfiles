import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const revisionSchema = z.object({ changeId: z.string(), commitId: z.string(), description: z.string(), conflict: z.boolean() }).strict()
export type ThreadRevisionView = z.infer<typeof revisionSchema>

const threadSchema = z
  .object({
    name: z.string(),
    path: z.string(),
    workspaceId: z.string().nullable(),
    /** The registered DSH workspace title; absent from a Host older than this field. */
    workspaceTitle: z.string().optional(),
    sessionIds: z.array(z.string()),
    finished: z.boolean(),
    canRebase: z.boolean().optional(),
    missing: z.boolean(),
    behind: z.boolean(),
    /** Absent from a Host older than this field. */
    behindCount: z.number().int().nonnegative().optional(),
    rebasedAt: z.number().int().nonnegative().optional(),
    rebasedTipChangeId: z.string().min(1).max(128).optional(),
    /** When the user queued an integration that waits for the thread to go idle; absent when none is queued. */
    integrationQueuedAt: z.number().int().nonnegative().optional(),
    /** Every recorded land, oldest first; absent from a Host older than this field. */
    integrations: z.array(z.object({ at: z.number().int().nonnegative(), tipChangeId: z.string().min(1).max(128).optional() }).strict()).optional(),
    unlanded: z.array(revisionSchema),
  })
  .strict()
export type ThreadView = z.infer<typeof threadSchema>

const repositorySchema = z.object({ repoRoot: z.string(), title: z.string(), workspaceId: z.string().nullable(), threads: z.array(threadSchema) }).strict()
export type RepositoryView = z.infer<typeof repositorySchema>

const integrationProgressSchema = z.object({ phase: z.enum(['queued', 'validating', 'rebasing']), updatedAt: z.number().int().nonnegative() }).strict()

const landResultSchema = z
  .object({
    status: z.enum(['landed', 'nothing-to-land', 'needs-description', 'conflicted']),
    revisions: z.array(revisionSchema),
    files: z.array(z.string()),
    bookmark: z.string(),
    /** Where the bookmark points after rebasing; absent from a Host older than this field. */
    head: revisionSchema.optional(),
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

export const jjIntegrationApi = defineApi({
  id: 'jj-threads',
  version: 1,
  owner: '@dshfiles/jj-integration',
  methods: {
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
      output: z.object({ projects: z.array(z.object({ workspaceId: z.string(), title: z.string(), path: z.string() }).strict()) }).strict(),
      description:
        'List registered projects (DSH Workspaces) that are real checkouts rather than thread workspaces, with their workspace id, title and path. Read-only.',
      tool: {
        name: 'jj_thread_projects',
        readOnly: true,
        render: output => output.projects.map(project => `${project.workspaceId} · ${project.title} · ${project.path}`).join('\n') || 'No registered projects.',
      },
    }),
    noFolder: method({ input: z.object({}).strict(), output: z.object({ workspaceId: z.string() }).strict() }),
    repositories: method({
      input: z.object({}).strict(),
      output: z.object({ repositories: z.array(repositorySchema) }).strict(),
      description:
        'List jj repositories and their thread workspaces: each thread workspace’s name, path, owning Sessions, finished state, pending revisions, how far behind the bookmark it is, and whether it can be integrated right now. Read-only.',
      tool: {
        name: 'jj_thread_repositories',
        readOnly: true,
        render: output =>
          output.repositories
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
            .join('\n') || 'No jj repositories with thread workspaces.',
      },
    }),
    threadAt: method({
      input: z.object({ path: z.string().min(1) }).strict(),
      output: z.object({ thread: threadSchema.nullable() }).strict(),
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
      input: z.object({ path: z.string().min(1), sessionId: z.string().optional() }).strict(),
      output: landResultSchema,
      description:
        'Rebase the thread at a path: move its described revisions onto the target bookmark and advance the bookmark. Never pushes. Refuses while any thread session is running or waiting for input; the calling agent may rebase its own thread once it resolved a handed-back problem.',
    }),
    queueLand: method({
      input: z.object({ path: z.string().min(1), sessionId: z.string().optional() }).strict(),
      output: z.object({ queuedAt: z.number().int().nonnegative() }).strict(),
      description:
        'Queue an integration of the thread at a path that runs as soon as every thread Session is idle and no question waits. The rebase itself keeps every guard of `land`; cancelQueuedLand undoes the request until it starts.',
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
    threadStatus: method({
      input: threadPathInput,
      output: z.object({ bookmark: z.string(), thread: threadSchema.nullable() }).strict(),
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
      input: threadPathInput,
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
      output: z.object({ status: z.enum(['discarded', 'has-work']), revisions: z.array(revisionSchema) }).strict(),
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
  },
})
