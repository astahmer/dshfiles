import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

export const revisionSchema = z.object({
  commitId: z.string().regex(/^[a-f0-9]{40,64}$/),
  changeId: z.string().regex(/^[a-f0-9]{20,64}$/),
  shortestChangeId: z.string().min(1).max(32),
  description: z.string().max(20_000),
  author: z.string().max(320),
  authorTime: z.string().max(64),
  parents: z.array(z.string().regex(/^[a-f0-9]{40,64}$/)).max(16),
  bookmarks: z.array(z.string().max(256)).max(64),
  localBookmarks: z.array(z.string().max(256)).max(64),
  tags: z.array(z.string().max(256)).max(64),
  workspaces: z.array(z.string().max(128)).max(32),
  workingCopy: z.boolean(),
  mine: z.boolean(),
  immutable: z.boolean(),
  divergent: z.boolean(),
  empty: z.boolean(),
  conflict: z.boolean(),
  evolved: z.boolean(),
  // Older Hosts omit it; jj only needs the offset to tell divergent copies apart.
  changeOffset: z.number().int().min(0).max(65_535).default(0),
})

const repoPathSchema = z.string().min(1).max(2048)
const repoIdSchema = z.string().uuid()
const commitIdSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const remoteNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/)
const bookmarkNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/+:-]{0,254}$/)
export const workspaceNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)

const pathListSchema = z.array(z.string().min(1).max(1024)).min(1).max(100)

export const mutationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('describe'), commitId: commitIdSchema, message: z.string().max(4000) }),
  z.object({ kind: z.literal('split'), commitId: commitIdSchema, paths: pathListSchema, message: z.string().min(1).max(4000) }),
  z.object({
    kind: z.literal('squash'),
    sourceId: commitIdSchema,
    destinationId: commitIdSchema,
    message: z.string().min(1).max(4000).optional(),
    paths: pathListSchema.optional(),
  }),
  z.object({ kind: z.literal('rebase'), sourceId: commitIdSchema, destinationId: commitIdSchema }),
  z.object({ kind: z.literal('bookmark-move'), bookmark: bookmarkNameSchema, destinationId: commitIdSchema }),
  z.object({ kind: z.literal('bookmark-set'), bookmark: bookmarkNameSchema, destinationId: commitIdSchema }),
  z.object({ kind: z.literal('bookmark-delete'), bookmark: bookmarkNameSchema }),
  z.object({ kind: z.literal('fetch'), remote: remoteNameSchema }),
  z.object({ kind: z.literal('push'), remote: remoteNameSchema, bookmark: bookmarkNameSchema }),
  z.object({ kind: z.literal('workspace-add'), parentPath: z.string().min(1).max(2048), name: workspaceNameSchema, commitId: commitIdSchema }),
  z.object({ kind: z.literal('edit'), commitId: commitIdSchema }),
  z.object({ kind: z.literal('new'), commitId: commitIdSchema }),
  z.object({ kind: z.literal('commit'), commitId: commitIdSchema, message: z.string().min(1).max(4000) }),
  z.object({ kind: z.literal('duplicate'), commitId: commitIdSchema }),
  z.object({ kind: z.literal('abandon'), commitIds: z.array(commitIdSchema).min(1).max(50) }),
  z.object({ kind: z.literal('revert'), commitId: commitIdSchema, destinationId: commitIdSchema }),
  z.object({ kind: z.literal('restore'), commitId: commitIdSchema, paths: pathListSchema }),
])

export const previewSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum([
    'describe',
    'split',
    'squash',
    'rebase',
    'bookmark-move',
    'bookmark-set',
    'bookmark-delete',
    'fetch',
    'push',
    'workspace-add',
    'edit',
    'new',
    'commit',
    'duplicate',
    'abandon',
    'revert',
    'restore',
  ]),
  title: z.string().max(200),
  summary: z.string().max(1000),
  detail: z.string().max(8000),
  expiresAt: z.number().int(),
})

export const fileStatusSchema = z.enum(['M', 'A', 'D', 'R', 'C'])

export const fileStatSchema = z.object({
  path: z.string().max(2048),
  status: fileStatusSchema,
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
})

export const fileChangeSchema = fileStatSchema.extend({
  contentDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
})

export const stateSchema = z.object({
  root: z.string().max(2048),
  revisions: z.array(revisionSchema).max(500),
  status: z.string().max(80_000),
  changedPaths: z.array(z.string().max(2048)).max(1000),
  remoteNames: z.array(z.string().max(128)).max(64),
  lastPushAt: z.string().max(64).nullable(),
  lastPushDescription: z.string().max(500).nullable(),
  lastPushHistoryTruncated: z.boolean(),
  evolutionHistoryTruncated: z.boolean(),
})

const detailsSchema = z.object({
  files: z.array(fileChangeSchema).max(1000),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  patch: z.string().max(1_200_000),
  truncated: z.boolean(),
  evolution: z.string().max(120_000),
})

// dshx replaces any thrown handler error with a generic message, so reads report their real failure in the output.
const readFailureSchema = z.object({ failure: z.object({ message: z.string().max(500) }) })

export const jujutsuApi = defineApi({
  id: 'jujutsu',
  version: 1,
  owner: '@dshfiles/jujutsu',
  methods: {
    registerRepository: method({
      input: z.object({ path: repoPathSchema }),
      output: z.object({ repoId: repoIdSchema, root: z.string().max(2048) }),
      description: 'Resolve a folder to its jj repository and return the repoId the other jujutsu methods take.',
    }),
    load: method({
      input: z.object({ repoId: repoIdSchema, limit: z.number().int().min(20).max(500).default(300) }),
      output: z.union([stateSchema, readFailureSchema]),
      description: 'Repository status: the revision graph, working-copy revision, bookmarks and conflicts, or a read failure.',
    }),
    details: method({
      input: z.object({ repoId: repoIdSchema, commitId: commitIdSchema }),
      output: z.union([detailsSchema, readFailureSchema]),
      description: 'One revision’s description, files, patch and evolution log.',
    }),
    revisionFiles: method({
      input: z.object({ repoId: repoIdSchema, commitIds: z.array(commitIdSchema).min(1).max(40) }),
      output: z.object({
        revisions: z.array(z.object({ commitId: commitIdSchema, files: z.array(fileStatSchema).max(2000) })).max(40),
        truncated: z.boolean(),
      }),
    }),
    workingDiff: method({
      input: z.object({ repoId: repoIdSchema }),
      output: z.object({ patch: z.string().max(1_200_000), truncated: z.boolean() }),
      description: 'The working-copy revision’s patch.',
    }),
    prepare: method({
      input: z.object({ repoId: repoIdSchema, action: mutationSchema }),
      output: previewSchema,
    }),
    confirm: method({
      input: z.object({ repoId: repoIdSchema, previewId: z.string().uuid() }),
      output: z.object({ message: z.string().max(1000), output: z.string().max(12_000), workspacePath: z.string().max(2048).nullable() }),
    }),
  },
})

export type Revision = z.infer<typeof revisionSchema>
export type Mutation = z.infer<typeof mutationSchema>
export type JujutsuState = z.infer<typeof stateSchema>
export type RevisionDetails = z.infer<typeof detailsSchema>
export type ReadFailure = z.infer<typeof readFailureSchema>
export type FileStat = z.infer<typeof fileStatSchema>
export type FileStatus = z.infer<typeof fileStatusSchema>
