import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'

/**
 * One `jj diff --git` for a whole thread can be large, and the RPC is one JSON
 * message, so the Host caps the patch it sends and flags the cut.
 */
export const MAX_PATCH_CHARS = 1_200_000
export const MAX_FILES = 4_000

export const scopeKeys = ['docs', 'code', 'tests', 'config', 'deps', 'generated', 'other'] as const
export const scopeKeySchema = Schema.Literals(scopeKeys)
export type ScopeKey = typeof scopeKeySchema.Type

export const reviewScopeSchema = Schema.Struct({
  key: scopeKeySchema,
  category: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  summary: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(400)),
  filePaths: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048))).check(Schema.isMaxLength(MAX_FILES)),
  additions: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  deletions: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})
export type ReviewScope = typeof reviewScopeSchema.Type

export const reviewFileSchema = Schema.Struct({
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  status: Schema.String.check(Schema.isMaxLength(32)),
  additions: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  deletions: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})
export type ReviewFile = typeof reviewFileSchema.Type

export const reviewFailureReasonSchema = Schema.Literals(['workspace-missing', 'not-a-repository', 'no-base', 'jj-missing', 'jj-failed'])
export type ReviewFailureReason = typeof reviewFailureReasonSchema.Type

export const reviewResultSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal('ok'),
    path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
    base: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
    head: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
    range: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
    patch: Schema.String.check(Schema.isMaxLength(MAX_PATCH_CHARS)),
    truncated: Schema.Boolean,
    fileCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    additions: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    deletions: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    files: Schema.Array(reviewFileSchema).check(Schema.isMaxLength(MAX_FILES)),
    scopes: Schema.Array(reviewScopeSchema).check(Schema.isMaxLength(16)),
  }),
  Schema.Struct({
    status: Schema.Literal('failed'),
    path: Schema.String.check(Schema.isMaxLength(2048)),
    reason: reviewFailureReasonSchema,
    message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(600)),
  }),
])
export type ReviewResult = typeof reviewResultSchema.Type

/** One selection is one screen of review, not an export of history. */
export const MAX_REVIEW_REVISIONS = 30

/** One revision's own change inside a combined review; `patch` shares the review's `MAX_PATCH_CHARS` budget. */
export const revisionReviewSchema = Schema.Struct({
  changeId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  shortChangeId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  commitId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  description: Schema.String.check(Schema.isMaxLength(300)),
  patch: Schema.String.check(Schema.isMaxLength(MAX_PATCH_CHARS)),
  truncated: Schema.Boolean,
  fileCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  additions: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  deletions: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  files: Schema.Array(reviewFileSchema).check(Schema.isMaxLength(MAX_FILES)),
})
export type RevisionReview = typeof revisionReviewSchema.Type

export const revisionsReviewFailureReasonSchema = Schema.Literals(['workspace-missing', 'not-a-repository', 'jj-missing', 'jj-failed'])
export type RevisionsReviewFailureReason = typeof revisionsReviewFailureReasonSchema.Type

/** Every selected revision on its own, ancestors first: a selection with gaps has no one diff to show. */
export const revisionsReviewResultSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal('ok'),
    path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
    revisions: Schema.Array(revisionReviewSchema).check(Schema.isMaxLength(MAX_REVIEW_REVISIONS)),
    /** Requested revisions that have no single current version; the rest of the selection is still reviewed. */
    unresolved: Schema.Array(
      Schema.Struct({
        revision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
        reason: Schema.Literals(['missing', 'divergent']),
        message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300)),
      }),
    ).check(Schema.isMaxLength(MAX_REVIEW_REVISIONS)),
    /** Unconnected runs in the selection; above 1, revisions between them are not part of this review. */
    segments: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    truncated: Schema.Boolean,
    fileCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    additions: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    deletions: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  }),
  Schema.Struct({
    status: Schema.Literal('failed'),
    path: Schema.String.check(Schema.isMaxLength(2048)),
    reason: revisionsReviewFailureReasonSchema,
    message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(600)),
  }),
])
export type RevisionsReviewResult = typeof revisionsReviewResultSchema.Type

export const summaryFailureReasonSchema = Schema.Literals(['no-route', 'llm-unavailable', 'llm-failed', 'unparsed', 'review-failed', 'no-changes'])
export type SummaryFailureReason = typeof summaryFailureReasonSchema.Type

/** One model call over the whole diff; a partial answer is still a success. */
export const summarizeResultSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal('ok'),
    route: Schema.Struct({
      provider: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
      model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
    }),
    summaries: Schema.Record(Schema.String, Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(600))).check(
      Schema.makeFilter(record => (Object.keys(record).every(key => scopeKeys.some(scopeKey => scopeKey === key)) ? true : 'Unknown review scope key.')),
    ),
  }),
  Schema.Struct({
    status: Schema.Literal('failed'),
    reason: summaryFailureReasonSchema,
    message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(600)),
  }),
])
export type SummarizeResult = typeof summarizeResultSchema.Type

export const summarizeInputSchema = Schema.Struct({
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  base: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  /** The thread whose model route should summarize; ignored when provider/model are given. */
  sessionId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
  provider: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120))),
  model: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
})

const reviewInputSchema = Schema.Struct({
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)).annotate({ description: 'Absolute path of the workspace to review.' }),
  base: Schema.optional(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)).annotate({
      description:
        'Base bookmark or revision; defaults to the project’s main branch (Settings › Projects, dsh.project.json or origin’s default branch), else the first of main, master or trunk.',
    }),
  ),
  fromChangeId: Schema.optional(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)).annotate({
      description: 'Persistent JJ change ID for the saved range base; requires toChangeId and path set to the owning repository root.',
    }),
  ),
  toChangeId: Schema.optional(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)).annotate({
      description: 'Persistent JJ change ID for the saved range head; requires fromChangeId and path set to the owning repository root.',
    }),
  ),
})

const revisionsReviewInputSchema = Schema.Struct({
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)).annotate({ description: 'Absolute path of a workspace of the repository.' }),
  revisions: Schema.Array(
    Schema.String.check(Schema.isPattern(/^[0-9a-z]{1,128}$/u)).annotate({
      description: 'A commit id, or a change id, in full or as a unique prefix, as jj log prints them. A revset expression is refused.',
    }),
  )
    .check(Schema.isMinLength(1), Schema.isMaxLength(MAX_REVIEW_REVISIONS))
    .annotate({ description: 'The revisions to review together; they need not be adjacent.' }),
})
export type RevisionsReviewInput = typeof revisionsReviewInputSchema.Type

export const pullsReviewApi = defineApi({
  id: 'pulls-review',
  owner: '@dshfiles/pulls-review',
  version: 1,
  methods: {
    review: method({
      input: reviewInputSchema,
      output: reviewResultSchema,
      description: "Read a workspace's changes since a base bookmark, or an exact saved change-ID range, and group the changed files into review scopes.",
    }),
    report: method({
      input: reviewInputSchema,
      output: Schema.Struct({ text: Schema.String }),
      description: "The review of a workspace's changes as the report text `/pulls` prints, for agents.",
      tool: {
        name: 'pulls_review',
        description:
          "Read a workspace's changes against a base bookmark, or an exact saved range of persistent JJ change IDs, and return pulls.review scopes with per-scope file and line counts.",
        readOnly: true,
        render: report => report.text,
      },
    }),
    reviewRevisions: method({
      input: revisionsReviewInputSchema,
      output: revisionsReviewResultSchema,
      description: 'Read each selected revision as its own change, ancestors first, for the combined review. A selection may have gaps.',
    }),
    reportRevisions: method({
      input: revisionsReviewInputSchema,
      output: Schema.Struct({ text: Schema.String }),
      description: 'The combined review of several revisions as text, for agents.',
      tool: {
        name: 'pulls_review_revisions',
        description:
          'Review several Jujutsu revisions together: each revision with its own changed files and line counts, ancestors first. The revisions need not be adjacent, and a selection with gaps is reported as such; use jj_details for a patch.',
        readOnly: true,
        render: report => report.text,
      },
    }),
    summarize: method({
      input: summarizeInputSchema,
      output: summarizeResultSchema,
      description: "Summarize a workspace's review scopes with the thread's own model route.",
    }),
  },
})
