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
    missing: z.boolean(),
    behind: z.boolean(),
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
    agentAsked: z.boolean(),
  })
  .strict()
export type LandResult = z.infer<typeof landResultSchema>

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
  })
  .strict()
export type DestinationView = z.infer<typeof destinationSchema>

export const jjIntegrationApi = defineApi({
  id: 'jj-threads',
  version: 1,
  owner: '@dshfiles/jj-integration',
  methods: {
    provision: method({
      input: z.object({ workspaceId: z.string().min(1), isolate: z.boolean().optional(), base: z.string().min(1).max(256).optional() }).strict(),
      output: z.object({ workspaceId: z.string(), isolated: z.boolean() }).strict(),
    }),
    destination: method({ input: z.object({ workspaceId: z.string().min(1) }).strict(), output: destinationSchema }),
    projects: method({
      input: z.object({}).strict(),
      output: z.object({ projects: z.array(z.object({ workspaceId: z.string(), title: z.string(), path: z.string() }).strict()) }).strict(),
    }),
    noFolder: method({ input: z.object({}).strict(), output: z.object({ workspaceId: z.string() }).strict() }),
    repositories: method({ input: z.object({}).strict(), output: z.object({ repositories: z.array(repositorySchema) }).strict() }),
    threadAt: method({ input: z.object({ path: z.string().min(1) }).strict(), output: z.object({ thread: threadSchema.nullable() }).strict() }),
    land: method({ input: z.object({ path: z.string().min(1), sessionId: z.string().optional() }).strict(), output: landResultSchema }),
    discard: method({
      input: z.object({ path: z.string().min(1), force: z.boolean() }).strict(),
      output: z.object({ status: z.enum(['discarded', 'has-work']), revisions: z.array(revisionSchema) }).strict(),
    }),
  },
})
