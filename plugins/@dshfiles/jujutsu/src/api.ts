import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

export const revisionSchema = z.object({
  commitId: z.string().regex(/^[a-f0-9]{40,64}$/),
  changeId: z.string().regex(/^[a-f0-9]{20,64}$/),
  shortestChangeId: z.string().min(1).max(32),
  description: z.string().max(20_000),
  author: z.string().max(320),
  authorTime: z.string().max(64),
  // Older Hosts omit it; day headings fall back to the author time.
  committerTime: z.string().max(64).optional(),
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
  z.object({ kind: z.literal('workspace-forget'), name: workspaceNameSchema }),
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
    'workspace-forget',
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
  /** Set by changed-file reads; an older Host omits it. */
  conflict: z.boolean().optional(),
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
  graphHasMore: z.boolean().default(false),
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

const graphSliceSchema = z.object({
  operationId: z.string().regex(/^[a-f0-9]{128}$/),
  revisions: z.array(revisionSchema).max(500),
  truncated: z.boolean(),
})

export const graphNavigationSchema = z.object({
  operationId: z.string().regex(/^[a-f0-9]{128}$/),
  landmarks: z
    .array(
      z.object({
        kind: z.enum(['current', 'main-origin', 'main', 'default']),
        label: z.string(),
        status: z.enum(['resolved', 'missing', 'ambiguous']),
        revisions: z.array(revisionSchema).max(500),
      }),
    )
    .max(4),
})

export const revisionRelationshipSchema = graphSliceSchema.extend({
  commitId: commitIdSchema,
  targetCommitId: commitIdSchema,
  relation: z.enum(['same', 'ancestor', 'descendant', 'diverged', 'no-common-ancestor']),
  selectedOnlyCount: z.number().int().nonnegative(),
  targetOnlyCount: z.number().int().nonnegative(),
  commonAncestorIds: z.array(commitIdSchema).max(500),
  commonAncestorsTruncated: z.boolean(),
  connectionIds: z.array(commitIdSchema).max(500),
  differenceIds: z.array(commitIdSchema).max(500),
})

export const referenceGraphSchema = z.object({
  label: z.string().min(1).max(255),
  commitId: commitIdSchema.nullable(),
  changeId: z.string().min(1).max(64).nullable(),
  /** Older Hosts omit it; use the identifier as the chat label until title metadata is available. */
  description: z.string().max(255).optional(),
  graph: z.string().max(20_000),
  /** Older Hosts send only the text graph; the preview falls back to it. */
  listedCommitIds: z.array(commitIdSchema).max(20).optional(),
  revisions: z.array(revisionSchema).max(400).optional(),
  defaultCommitId: commitIdSchema.nullable().optional(),
})

export type GraphSlice = z.infer<typeof graphSliceSchema>
export type ReferenceGraph = z.infer<typeof referenceGraphSchema>
export type GraphLandmark = z.infer<typeof graphNavigationSchema>['landmarks'][number]
export type GraphNavigation = z.infer<typeof graphNavigationSchema>
export type RevisionRelationship = z.infer<typeof revisionRelationshipSchema>

/** Model-facing text for a structured tool result. */
const compactJson = <Output>(output: Output): string => JSON.stringify(output)

/** The patch decides the render: a small one is shown, a large one only counted. */
const patchText = (patch: string): string =>
  patch.length <= 8000 ? patch : `${String(patch.length)} characters of patch, too large to show; read it file by file with jj_details or jj_revision_files.`

const readFailureText = (value: { readonly message?: string; readonly failure?: { readonly message: string } }): string =>
  value.message ?? value.failure?.message ?? compactJson(value)

export const jujutsuApi = defineApi({
  id: 'jujutsu',
  version: 1,
  owner: '@dshfiles/jujutsu',
  methods: {
    registerRepository: method({
      input: z.object({ path: repoPathSchema }),
      output: z.object({ repoId: repoIdSchema, root: z.string().max(2048) }),
      description: 'Resolve a folder to its jj repository and return the repoId every other jujutsu tool takes. Read-only.',
      tool: { name: 'jj_register_repository', readOnly: true, render: output => `${output.repoId} · ${output.root}` },
    }),
    load: method({
      input: z.object({ repoId: repoIdSchema, limit: z.number().int().min(1).max(500).default(100) }),
      output: z.union([stateSchema, readFailureSchema]),
      description: 'Repository status and the first page of the revision graph: root, revisions, changed paths, remotes and the last push. Read-only.',
      tool: {
        name: 'jj_load',
        readOnly: true,
        render: output =>
          'root' in output
            ? `${output.root} · ${String(output.revisions.length)} revision(s)${output.graphHasMore ? ' (more)' : ''} · ${String(output.changedPaths.length)} changed path(s)${output.remoteNames.length === 0 ? '' : ` · remotes ${output.remoteNames.join(', ')}`}`
            : readFailureText(output),
      },
    }),
    graphPage: method({
      input: z.object({
        repoId: repoIdSchema,
        query: z.string().max(256).default(''),
        excludeCommitIds: z.array(commitIdSchema).max(10_000),
      }),
      output: z.union([z.object({ revisions: z.array(revisionSchema).max(100), hasMore: z.boolean() }), readFailureSchema]),
      description: 'Load the next revision graph page, or search all visible revisions with a query. Read-only.',
      tool: {
        name: 'jj_graph_page',
        readOnly: true,
        render: output =>
          'revisions' in output ? `${String(output.revisions.length)} revision(s)${output.hasMore ? ' (more)' : ''}` : readFailureText(output),
      },
    }),
    workspaces: method({
      input: z.object({ repoId: repoIdSchema }),
      output: z.object({ workspaces: z.array(z.object({ name: workspaceNameSchema, path: z.string().min(1).max(2048) })).max(64) }),
      description: 'Every Jujutsu workspace of this repository with its folder, including workspaces no DSH project is registered for. Read-only.',
      tool: {
        name: 'jj_workspaces',
        readOnly: true,
        render: output => output.workspaces.map(workspace => `${workspace.name} · ${workspace.path}`).join('\n') || 'No workspaces.',
      },
    }),
    graphNavigation: method({
      input: z.object({ repoId: repoIdSchema }),
      output: z.union([graphNavigationSchema, readFailureSchema]),
      description: 'Resolve the current, main@origin, main and default-workspace landmarks in one call. Read-only.',
      tool: { name: 'jj_graph_navigation', readOnly: true, render: compactJson },
    }),
    revisionRelationship: method({
      input: z.object({ repoId: repoIdSchema, commitId: commitIdSchema, targetCommitId: commitIdSchema }),
      output: z.union([revisionRelationshipSchema, readFailureSchema]),
      description: 'Exact ancestry counts between two revisions and the bounded graph sets around them; the relation is relative to the target. Read-only.',
      tool: { name: 'jj_revision_relationship', readOnly: true, render: compactJson },
    }),
    graphSlice: method({
      input: z.object({ repoId: repoIdSchema, commitId: commitIdSchema, mode: z.enum(['history', 'exclusive']) }),
      output: z.union([graphSliceSchema, readFailureSchema]),
      description: 'One bounded graph slice: one revision history, or the history exclusive of other heads, bookmarks and workspaces. Read-only.',
      tool: { name: 'jj_graph_slice', readOnly: true, render: compactJson },
    }),
    referenceGraph: method({
      input: z.object({ repoId: repoIdSchema, reference: z.string().min(1).max(255) }),
      output: z.union([referenceGraphSchema, readFailureSchema]),
      description:
        'A small revision graph around one chat reference — a revision or a bookmark — with its neighbourhood and the working copy, main, main@origin and default-workspace landmarks. Read-only.',
      tool: {
        name: 'jj_reference_graph',
        readOnly: true,
        render: output => ('graph' in output ? `${output.label}\n${output.graph}` : readFailureText(output)),
      },
    }),
    details: method({
      input: z.object({ repoId: repoIdSchema, commitId: commitIdSchema }),
      output: z.union([detailsSchema, readFailureSchema]),
      description: 'One revision: its description, files, patch and evolution log. Read-only.',
      tool: {
        name: 'jj_details',
        readOnly: true,
        render: output =>
          'files' in output
            ? `${String(output.files.length)} file(s) · +${String(output.additions)}/-${String(output.deletions)}${output.truncated ? ' · truncated' : ''}\n${patchText(output.patch)}`
            : readFailureText(output),
      },
    }),
    revisionFiles: method({
      input: z.object({ repoId: repoIdSchema, commitIds: z.array(commitIdSchema).min(1).max(40) }),
      output: z.object({
        revisions: z.array(z.object({ commitId: commitIdSchema, files: z.array(fileStatSchema).max(2000) })).max(40),
        truncated: z.boolean(),
      }),
      description: 'Changed files and per-file stats for up to 40 revisions at once, the way the graph file list shows them. Read-only.',
      tool: {
        name: 'jj_revision_files',
        readOnly: true,
        render: output =>
          output.revisions
            .map(
              revision =>
                `${revision.commitId}: ${revision.files
                  .slice(0, 20)
                  .map(file => `${file.status} ${file.path}`)
                  .join(', ')}${revision.files.length > 20 ? ` (+${String(revision.files.length - 20)} more)` : ''}`,
            )
            .join('\n') + (output.truncated ? '\n(truncated)' : ''),
      },
    }),
    editTimes: method({
      input: z.object({ repoId: repoIdSchema, commitIds: z.array(commitIdSchema).min(1).max(100) }),
      output: z.object({ revisions: z.array(z.object({ commitId: commitIdSchema, editedAt: z.string().max(64).nullable() })).max(100) }),
      description:
        "When each revision's own content last changed, from its evolution log: rebases and description edits do not count. editedAt is null when the content never changed after the revision was created. Read-only.",
      tool: {
        name: 'jj_edit_times',
        readOnly: true,
        render: output => output.revisions.map(revision => `${revision.commitId} ${revision.editedAt ?? 'never edited'}`).join('\n'),
      },
    }),
    workingDiff: method({
      input: z.object({ repoId: repoIdSchema }),
      output: z.object({ patch: z.string().max(1_200_000), truncated: z.boolean() }),
      description: 'The working-copy patch, for reading uncommitted changes without shelling out. Read-only.',
      tool: { name: 'jj_working_diff', readOnly: true, render: output => patchText(output.patch) },
    }),
    prepare: method({
      input: z.object({ repoId: repoIdSchema, action: mutationSchema }),
      output: previewSchema,
      description:
        'Prepare one jujutsu action and return its preview: title, summary, detail and the previewId that jj_confirm_action applies. Preparing changes nothing. Call only when the user asked for that action; show them the summary before confirming. Actions: describe, split, squash, rebase, bookmark-move, bookmark-set, bookmark-delete, fetch, push, workspace-add, workspace-forget, edit, new, commit, duplicate, abandon, revert, restore.',
      tool: {
        name: 'jj_prepare_action',
        render: output => `${output.title} · ${output.summary}\n${output.detail}\npreviewId ${output.id} (expires ${new Date(output.expiresAt).toISOString()})`,
      },
    }),
    confirm: method({
      input: z.object({ repoId: repoIdSchema, previewId: z.string().uuid() }),
      output: z.object({ message: z.string().max(1000), output: z.string().max(12_000), workspacePath: z.string().max(2048).nullable() }),
      description:
        'Apply one prepared jujutsu action by its previewId and return the command message and output. Call only when the user asked, after jj_prepare_action showed them the plan.',
      tool: {
        name: 'jj_confirm_action',
        render: output => `${output.message}\n${output.output.slice(0, 2000)}${output.workspacePath === null ? '' : `\nworkspace ${output.workspacePath}`}`,
      },
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
