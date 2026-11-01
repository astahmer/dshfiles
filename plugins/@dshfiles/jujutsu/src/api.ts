import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { SchemaHelpers } from './schema-helpers.js'

export const REVISION_PAGE_SIZE = 10
// One revision can be the working copy of every thread workspace; the Host's bounded jj output still caps the row.
const MAX_REVISION_WORKSPACES = 1024

export const revisionSchema = Schema.Struct({
  commitId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40,64}$/)),
  changeId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{20,64}$/)),
  shortestChangeId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  // A squash merge can carry every folded commit message; the Host's bounded jj output is what caps it.
  description: Schema.String.check(Schema.isMaxLength(1_000_000)),
  author: Schema.String.check(Schema.isMaxLength(320)),
  authorTime: Schema.String.check(Schema.isMaxLength(64)),
  // Older Hosts omit it; day headings fall back to the author time.
  committerTime: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(64))),
  parents: Schema.Array(Schema.String.check(Schema.isPattern(/^[a-f0-9]{40,64}$/))).check(Schema.isMaxLength(16)),
  bookmarks: Schema.Array(Schema.String.check(Schema.isMaxLength(256))).check(Schema.isMaxLength(64)),
  localBookmarks: Schema.Array(Schema.String.check(Schema.isMaxLength(256))).check(Schema.isMaxLength(64)),
  remoteBookmarksText: SchemaHelpers.withDecodedDefault(Schema.String.check(Schema.isMaxLength(32_768)), () => ''),
  tags: Schema.Array(Schema.String.check(Schema.isMaxLength(256))).check(Schema.isMaxLength(64)),
  workspaces: Schema.Array(Schema.String.check(Schema.isMaxLength(128))).check(Schema.isMaxLength(MAX_REVISION_WORKSPACES)),
  workingCopy: Schema.Boolean,
  mine: Schema.Boolean,
  immutable: Schema.Boolean,
  divergent: Schema.Boolean,
  empty: Schema.Boolean,
  conflict: Schema.Boolean,
  evolved: Schema.Boolean,
  // Older Hosts omit it; jj only needs the offset to tell divergent copies apart.
  changeOffset: SchemaHelpers.withDecodedDefault(
    Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(65_535)),
    () => 0,
  ),
})

const repoPathSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048))
const repoIdSchema = Schema.String.check(Schema.isUUID())
const commitIdSchema = Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/))
/**
 * A revision the caller names, as a full commit id, a unique hex prefix or a
 * change id — what `jj log` prints and what a chat reference carries. Read-only
 * tools resolve it against the repository; mutations still take full ids so a
 * typo can never pick the wrong revision to rewrite.
 */
const revisionRefSchema = Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{4,64}|[k-z]{4,32})$/))
const remoteNameSchema = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/))
const bookmarkNameSchema = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._/+:-]{0,254}$/))
export const workspaceNameSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
)

const pathListSchema = Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024))).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(100),
)

const mutationSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('describe'), commitId: commitIdSchema, message: Schema.String.check(Schema.isMaxLength(4000)) }),
  Schema.Struct({
    kind: Schema.Literal('split'),
    commitId: commitIdSchema,
    paths: pathListSchema,
    message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000)),
  }),
  Schema.Struct({
    kind: Schema.Literal('squash'),
    sourceId: commitIdSchema,
    destinationId: commitIdSchema,
    message: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000))),
    paths: Schema.optionalKey(pathListSchema),
  }),
  Schema.Struct({ kind: Schema.Literal('rebase'), sourceId: commitIdSchema, destinationId: commitIdSchema }),
  Schema.Struct({ kind: Schema.Literal('bookmark-move'), bookmark: bookmarkNameSchema, destinationId: commitIdSchema }),
  Schema.Struct({ kind: Schema.Literal('bookmark-set'), bookmark: bookmarkNameSchema, destinationId: commitIdSchema }),
  Schema.Struct({ kind: Schema.Literal('bookmark-delete'), bookmark: bookmarkNameSchema }),
  Schema.Struct({ kind: Schema.Literal('fetch'), remote: remoteNameSchema }),
  Schema.Struct({ kind: Schema.Literal('push'), remote: remoteNameSchema, bookmark: bookmarkNameSchema }),
  Schema.Struct({
    kind: Schema.Literal('workspace-add'),
    parentPath: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
    name: workspaceNameSchema,
    commitId: commitIdSchema,
  }),
  Schema.Struct({ kind: Schema.Literal('workspace-forget'), name: workspaceNameSchema }),
  Schema.Struct({ kind: Schema.Literal('workspace-edit'), name: workspaceNameSchema, commitId: commitIdSchema }),
  Schema.Struct({ kind: Schema.Literal('edit'), commitId: commitIdSchema }),
  Schema.Struct({ kind: Schema.Literal('new'), commitId: commitIdSchema }),
  Schema.Struct({ kind: Schema.Literal('commit'), commitId: commitIdSchema, message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000)) }),
  Schema.Struct({ kind: Schema.Literal('duplicate'), commitId: commitIdSchema }),
  Schema.Struct({ kind: Schema.Literal('abandon'), commitIds: Schema.Array(commitIdSchema).check(Schema.isMinLength(1), Schema.isMaxLength(50)) }),
  Schema.Struct({ kind: Schema.Literal('revert'), commitId: commitIdSchema, destinationId: commitIdSchema }),
  Schema.Struct({ kind: Schema.Literal('restore'), commitId: commitIdSchema, paths: pathListSchema }),
])

export const previewSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  kind: Schema.Literals([
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
    'workspace-edit',
    'edit',
    'new',
    'commit',
    'duplicate',
    'abandon',
    'revert',
    'restore',
  ]),
  title: Schema.String.check(Schema.isMaxLength(200)),
  summary: Schema.String.check(Schema.isMaxLength(1000)),
  detail: Schema.String.check(Schema.isMaxLength(8000)),
  expiresAt: Schema.Number.check(Schema.isFinite(), Schema.isInt()),
})

export const fileStatusSchema = Schema.Literals(['M', 'A', 'D', 'R', 'C'])

const fileStatSchema = Schema.Struct({
  path: Schema.String.check(Schema.isMaxLength(2048)),
  status: fileStatusSchema,
  additions: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  deletions: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  /** Set by changed-file reads; an older Host omits it. */
  conflict: Schema.optionalKey(Schema.Boolean),
})

const fileChangeSchema = Schema.Struct({
  ...fileStatSchema.fields,
  contentDigest: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
})

const stateSchema = Schema.Struct({
  root: Schema.String.check(Schema.isMaxLength(2048)),
  revisions: Schema.Array(revisionSchema).check(Schema.isMaxLength(500)),
  graphHasMore: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => false),
  status: Schema.String.check(Schema.isMaxLength(80_000)),
  changedPaths: Schema.Array(Schema.String.check(Schema.isMaxLength(2048))).check(Schema.isMaxLength(1000)),
  remoteNames: Schema.Array(Schema.String.check(Schema.isMaxLength(128))).check(Schema.isMaxLength(64)),
  lastPushAt: Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))),
  lastPushDescription: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
  lastPushHistoryTruncated: Schema.Boolean,
  evolutionHistoryTruncated: Schema.Boolean,
})

const detailsSchema = Schema.Struct({
  files: Schema.Array(fileChangeSchema).check(Schema.isMaxLength(1000)),
  additions: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  deletions: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  patch: Schema.String.check(Schema.isMaxLength(1_200_000)),
  truncated: Schema.Boolean,
  evolution: Schema.String.check(Schema.isMaxLength(120_000)),
})

// dshx replaces any thrown handler error with a generic message, so reads report their real failure in the output.
const readFailureSchema = Schema.Struct({ failure: Schema.Struct({ message: Schema.String.check(Schema.isMaxLength(500)) }) })

const graphSliceSchema = Schema.Struct({
  operationId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{128}$/)),
  revisions: Schema.Array(revisionSchema).check(Schema.isMaxLength(500)),
  truncated: Schema.Boolean,
})

const graphNavigationSchema = Schema.Struct({
  operationId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{128}$/)),
  landmarks: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(['current', 'main-origin', 'main', 'default']),
      label: Schema.String,
      status: Schema.Literals(['resolved', 'missing', 'ambiguous']),
      revisions: Schema.Array(revisionSchema).check(Schema.isMaxLength(500)),
    }),
  ).check(Schema.isMaxLength(4)),
})

const revisionRelationshipSchema = Schema.Struct({
  ...graphSliceSchema.fields,
  commitId: commitIdSchema,
  targetCommitId: commitIdSchema,
  relation: Schema.Literals(['same', 'ancestor', 'descendant', 'diverged', 'no-common-ancestor']),
  selectedOnlyCount: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  targetOnlyCount: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  commonAncestorIds: Schema.Array(commitIdSchema).check(Schema.isMaxLength(500)),
  commonAncestorsTruncated: Schema.Boolean,
  connectionIds: Schema.Array(commitIdSchema).check(Schema.isMaxLength(500)),
  differenceIds: Schema.Array(commitIdSchema).check(Schema.isMaxLength(500)),
})

export const graphPageOutputSchema = Schema.Struct({
  revisions: Schema.Array(revisionSchema).check(Schema.isMaxLength(REVISION_PAGE_SIZE)),
  hasMore: Schema.Boolean,
})

const referenceGraphSchema = Schema.Struct({
  label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  commitId: Schema.NullOr(commitIdSchema),
  changeId: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  /** Older Hosts omit it; use the identifier as the chat label until title metadata is available. */
  description: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(255))),
  graph: Schema.String.check(Schema.isMaxLength(20_000)),
  /** Older Hosts send only the text graph; the preview falls back to it. */
  listedCommitIds: Schema.optionalKey(Schema.Array(commitIdSchema).check(Schema.isMaxLength(20))),
  revisions: Schema.optionalKey(Schema.Array(revisionSchema).check(Schema.isMaxLength(400))),
  defaultCommitId: Schema.optionalKey(Schema.NullOr(commitIdSchema)),
})

export type GraphSlice = Schema.Schema.Type<typeof graphSliceSchema>
export type ReferenceGraph = Schema.Schema.Type<typeof referenceGraphSchema>
export type GraphLandmark = Schema.Schema.Type<typeof graphNavigationSchema>['landmarks'][number]
export type GraphNavigation = Schema.Schema.Type<typeof graphNavigationSchema>
export type RevisionRelationship = Schema.Schema.Type<typeof revisionRelationshipSchema>

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
    openRepository: method({
      input: Schema.Struct({ path: repoPathSchema }),
      output: Schema.Struct({ repoId: repoIdSchema, root: Schema.String.check(Schema.isMaxLength(2048)), initialized: Schema.Boolean }),
      description:
        'Open a repository for Jujutsu. Automatically initialize colocated JJ metadata for an existing Git checkout; preserve Git history and files. Does not create Git repositories, fetch or push. Call only when the user asked to open or enable Jujutsu for that folder.',
      tool: {
        name: 'jj_open_repository',
        readOnly: false,
        render: output => `${output.repoId} · ${output.root}${output.initialized ? ' · Jujutsu enabled alongside Git' : ''}`,
      },
    }),
    registerRepository: method({
      input: Schema.Struct({ path: repoPathSchema }),
      output: Schema.Struct({ repoId: repoIdSchema, root: Schema.String.check(Schema.isMaxLength(2048)) }),
      description: 'Resolve a folder to its jj repository and return the repoId every other jujutsu tool takes. Read-only.',
      tool: { name: 'jj_register_repository', readOnly: true, render: output => `${output.repoId} · ${output.root}` },
    }),
    registerRepositories: method({
      input: Schema.Struct({ paths: Schema.Array(repoPathSchema).check(Schema.isMinLength(1), Schema.isMaxLength(31)) }),
      output: Schema.Struct({
        repositories: Schema.Array(
          Schema.Struct({
            path: repoPathSchema,
            repoId: Schema.NullOr(repoIdSchema),
            root: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2048))),
          }),
        ).check(Schema.isMaxLength(31)),
      }),
      description:
        'Resolve up to 31 folders to their jj repositories in one call, reporting a null row per non-repository path instead of failing the batch. Read-only.',
    }),
    load: method({
      input: Schema.Struct({
        repoId: repoIdSchema,
        limit: SchemaHelpers.withDecodedDefault(
          Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(REVISION_PAGE_SIZE)),
          () => REVISION_PAGE_SIZE,
        ),
      }),
      output: Schema.Union([stateSchema, readFailureSchema]),
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
      input: Schema.Struct({
        repoId: repoIdSchema,
        query: SchemaHelpers.withDecodedDefault(Schema.String.check(Schema.isMaxLength(256)), () => ''),
        excludeCommitIds: Schema.Array(commitIdSchema).check(Schema.isMaxLength(10_000)),
      }),
      output: Schema.Union([graphPageOutputSchema, readFailureSchema]),
      description: 'Load the next revision graph page, or search all visible revisions with a query. Read-only.',
      tool: {
        name: 'jj_graph_page',
        readOnly: true,
        render: output =>
          'revisions' in output ? `${String(output.revisions.length)} revision(s)${output.hasMore ? ' (more)' : ''}` : readFailureText(output),
      },
    }),
    workspaces: method({
      input: Schema.Struct({ repoId: repoIdSchema }),
      output: Schema.Struct({
        workspaces: Schema.Array(
          Schema.Struct({ name: workspaceNameSchema, path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)) }),
        ).check(Schema.isMaxLength(64)),
      }),
      description: 'Every Jujutsu workspace of this repository with its folder, including workspaces no DSH project is registered for. Read-only.',
      tool: {
        name: 'jj_workspaces',
        readOnly: true,
        render: output => output.workspaces.map(workspace => `${workspace.name} · ${workspace.path}`).join('\n') || 'No workspaces.',
      },
    }),
    graphNavigation: method({
      input: Schema.Struct({ repoId: repoIdSchema }),
      output: Schema.Union([graphNavigationSchema, readFailureSchema]),
      description: 'Resolve the current, main@origin, main and default-workspace landmarks in one call. Read-only.',
      tool: { name: 'jj_graph_navigation', readOnly: true, render: compactJson },
    }),
    revisionRelationship: method({
      input: Schema.Struct({ repoId: repoIdSchema, commitId: commitIdSchema, targetCommitId: commitIdSchema }),
      output: Schema.Union([revisionRelationshipSchema, readFailureSchema]),
      description: 'Exact ancestry counts between two revisions and the bounded graph sets around them; the relation is relative to the target. Read-only.',
      tool: { name: 'jj_revision_relationship', readOnly: true, render: compactJson },
    }),
    graphSlice: method({
      input: Schema.Struct({ repoId: repoIdSchema, commitId: commitIdSchema, mode: Schema.Literals(['history', 'exclusive']) }),
      output: Schema.Union([graphSliceSchema, readFailureSchema]),
      description: 'One bounded graph slice: one revision history, or the history exclusive of other heads, bookmarks and workspaces. Read-only.',
      tool: { name: 'jj_graph_slice', readOnly: true, render: compactJson },
    }),
    referenceGraph: method({
      input: Schema.Struct({ repoId: repoIdSchema, reference: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)) }),
      output: Schema.Union([referenceGraphSchema, readFailureSchema]),
      description:
        'A small revision graph around one chat reference — a revision or a bookmark — with its neighbourhood and the working copy, main, main@origin and default-workspace landmarks. Read-only.',
      tool: {
        name: 'jj_reference_graph',
        readOnly: true,
        render: output => ('graph' in output ? `${output.label}\n${output.graph}` : readFailureText(output)),
      },
    }),
    details: method({
      input: Schema.Struct({ repoId: repoIdSchema, commitId: revisionRefSchema }),
      output: Schema.Union([detailsSchema, readFailureSchema]),
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
      input: Schema.Struct({ repoId: repoIdSchema, commitIds: Schema.Array(commitIdSchema).check(Schema.isMinLength(1), Schema.isMaxLength(40)) }),
      output: Schema.Struct({
        revisions: Schema.Array(
          Schema.Struct({
            commitId: commitIdSchema,
            files: Schema.Array(fileStatSchema).check(Schema.isMaxLength(2000)),
          }),
        ).check(Schema.isMaxLength(40)),
        truncated: Schema.Boolean,
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
      input: Schema.Struct({ repoId: repoIdSchema, commitIds: Schema.Array(commitIdSchema).check(Schema.isMinLength(1), Schema.isMaxLength(100)) }),
      output: Schema.Struct({
        revisions: Schema.Array(
          Schema.Struct({ commitId: commitIdSchema, editedAt: Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))) }),
        ).check(Schema.isMaxLength(100)),
      }),
      description:
        "When each revision's own content last changed, from its evolution log: rebases and description edits do not count. editedAt is null when the content never changed after the revision was created. Read-only.",
      tool: {
        name: 'jj_edit_times',
        readOnly: true,
        render: output => output.revisions.map(revision => `${revision.commitId} ${revision.editedAt ?? 'never edited'}`).join('\n'),
      },
    }),
    workingDiff: method({
      input: Schema.Struct({ repoId: repoIdSchema }),
      output: Schema.Struct({ patch: Schema.String.check(Schema.isMaxLength(1_200_000)), truncated: Schema.Boolean }),
      description: 'The working-copy patch, for reading uncommitted changes without shelling out. Read-only.',
      tool: { name: 'jj_working_diff', readOnly: true, render: output => patchText(output.patch) },
    }),
    prepare: method({
      input: Schema.Struct({ repoId: repoIdSchema, action: mutationSchema }),
      output: previewSchema,
      description:
        'Prepare one jujutsu action and return its preview: title, summary, detail and the previewId that jj_confirm_action applies. Preparing changes nothing. Call only when the user asked for that action; show them the summary before confirming. Actions: describe, split, squash, rebase, bookmark-move, bookmark-set, bookmark-delete, fetch, push, workspace-add, workspace-forget, workspace-edit, edit, new, commit, duplicate, abandon, revert, restore.',
      tool: {
        name: 'jj_prepare_action',
        render: output => `${output.title} · ${output.summary}\n${output.detail}\npreviewId ${output.id} (expires ${new Date(output.expiresAt).toISOString()})`,
      },
    }),
    confirm: method({
      input: Schema.Struct({ repoId: repoIdSchema, previewId: Schema.String.check(Schema.isUUID()) }),
      output: Schema.Struct({
        message: Schema.String.check(Schema.isMaxLength(1000)),
        output: Schema.String.check(Schema.isMaxLength(12_000)),
        workspacePath: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2048))),
      }),
      description:
        'Apply one prepared jujutsu action by its previewId and return the command message and output. Call only when the user asked, after jj_prepare_action showed them the plan.',
      tool: {
        name: 'jj_confirm_action',
        render: output => `${output.message}\n${output.output.slice(0, 2000)}${output.workspacePath === null ? '' : `\nworkspace ${output.workspacePath}`}`,
      },
    }),
  },
})

export type Revision = Schema.Schema.Type<typeof revisionSchema>
export type Mutation = Schema.Schema.Type<typeof mutationSchema>
export type JujutsuState = Schema.Schema.Type<typeof stateSchema>
export type RevisionDetails = Schema.Schema.Type<typeof detailsSchema>
export type ReadFailure = Schema.Schema.Type<typeof readFailureSchema>
export type FileStat = Schema.Schema.Type<typeof fileStatSchema>
export type FileStatus = Schema.Schema.Type<typeof fileStatusSchema>
