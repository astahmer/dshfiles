import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const revisionSchema = z.object({ changeId: z.string(), commitId: z.string(), description: z.string(), conflict: z.boolean() }).strict()
export type ThreadRevisionView = z.infer<typeof revisionSchema>

const threadSchema = z
  .object({
    name: z.string(),
    path: z.string(),
    workspaceId: z.string().nullable(),
    sessionIds: z.array(z.string()),
    finished: z.boolean(),
    canRebase: z.boolean().optional(),
    missing: z.boolean(),
    behind: z.boolean(),
    rebasedAt: z.number().int().nonnegative().optional(),
    unlanded: z.array(revisionSchema),
  })
  .strict()
export type ThreadView = z.infer<typeof threadSchema>

const repositorySchema = z.object({ repoRoot: z.string(), title: z.string(), workspaceId: z.string().nullable(), threads: z.array(threadSchema) }).strict()
export type RepositoryView = z.infer<typeof repositorySchema>

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
    }),
    projects: method({
      input: z.object({}).strict(),
      output: z.object({ projects: z.array(z.object({ workspaceId: z.string(), title: z.string(), path: z.string() }).strict()) }).strict(),
    }),
    noFolder: method({ input: z.object({}).strict(), output: z.object({ workspaceId: z.string() }).strict() }),
    repositories: method({ input: z.object({}).strict(), output: z.object({ repositories: z.array(repositorySchema) }).strict() }),
    threadAt: method({
      input: z.object({ path: z.string().min(1) }).strict(),
      output: z.object({ thread: threadSchema.nullable() }).strict(),
      description:
        'The thread workspace at a path (revisions not yet on the bookmark, conflicts, whether main moved, and whether it is safe to rebase), or null when the path is not a thread.',
    }),
    isolate: method({
      input: z.object({}).strict(),
      output: isolatedWorkspaceSchema,
      description:
        'Before the first code edit, call when this task needs code changes and the current Session is not already in a dedicated thread workspace. Creates one from the current working-copy revision. The Session cwd does not change: use the returned absolute path for every subsequent file operation and shell workdir. No commit or rebase occurs.',
      tool: {
        name: 'jj_thread_isolate',
        render: output =>
          `${output.created ? 'Created' : 'Already in'} isolated jj workspace ${output.name} at ${output.path}. Use that absolute path for all subsequent file operations and shell workdir. Thread status and rebase tools will target this workspace automatically.`,
      },
    }),
    land: method({
      input: z.object({ path: z.string().min(1), sessionId: z.string().optional() }).strict(),
      output: landResultSchema,
      description:
        'Rebase the thread at a path: move its described revisions onto the target bookmark and advance the bookmark. Never pushes. Refuses while any thread session is running or waiting for input.',
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
        'Rebase this thread’s described work onto the target bookmark (main by default) and advance the bookmark. Refuses while any thread session is running or waiting for input, refuses undescribed revisions, reports conflicts to resolve, and never pushes. Call only when the user asked to rebase this thread’s work.',
      tool: { name: 'jj_thread_rebase', render: output => output.summary },
    }),
    workspaceSync: method({
      input: z.object({}).strict(),
      output: z.object({ sync: workspaceSyncSchema.nullable() }).strict(),
      description: 'State of the last sync of the DSH checkout onto main after rebasing: status, rebuilt plugins, and whether a restart is needed.',
    }),
    discard: method({
      input: z.object({ path: z.string().min(1), force: z.boolean() }).strict(),
      output: z.object({ status: z.enum(['discarded', 'has-work']), revisions: z.array(revisionSchema) }).strict(),
    }),
  },
})
