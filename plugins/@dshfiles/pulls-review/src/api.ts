import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'
import { reviewReportText } from './report.js'

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

export const pullsReviewApi = defineApi({
  id: 'pulls-review',
  owner: '@dshfiles/pulls-review',
  version: 1,
  methods: {
    review: method({
      input: Schema.Struct({
        path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)).annotate({ description: 'Absolute path of the workspace to review.' }),
        base: Schema.optional(
          Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)).annotate({
            description: 'Base bookmark or revision; defaults to the first of main, master or trunk.',
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
      }),
      output: reviewResultSchema,
      description: "Read a workspace's changes since a base bookmark, or an exact saved change-ID range, and group the changed files into review scopes.",
      tool: {
        name: 'pulls_review',
        description:
          "Read a workspace's changes against a base bookmark, or an exact saved range of persistent JJ change IDs, and return pulls.review scopes with per-scope file and line counts.",
        readOnly: true,
        render: reviewReportText,
      },
    }),
    summarize: method({
      input: summarizeInputSchema,
      output: summarizeResultSchema,
      description: "Summarize a workspace's review scopes with the thread's own model route.",
    }),
  },
})
