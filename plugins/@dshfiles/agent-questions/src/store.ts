import { Schema } from 'effect'
import { defineDomain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'

const trimmedString = (minimum: number, maximum: number) => Schema.Trim.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum))
const sessionIdSchema = trimmedString(1, 256)
const sha256Schema = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))

const parentQuestionOptionSchema = Schema.Struct({
  id: trimmedString(1, 80),
  label: trimmedString(1, 120),
  description: Schema.optionalKey(trimmedString(1, 1_000)),
})

export const parentQuestionOptionsSchema = Schema.Array(parentQuestionOptionSchema).check(
  Schema.isMinLength(2),
  Schema.isMaxLength(8),
  Schema.makeFilter(options => (new Set(options.map(option => option.id)).size === options.length ? undefined : 'Question option ids must be unique.')),
)

export const parentQuestionExpiryBehaviorSchema = Schema.Literals(['recommended', 'defer'])
export type ParentQuestionExpiryBehavior = typeof parentQuestionExpiryBehaviorSchema.Type

export const deferredFilePathSchema = Schema.String.check(Schema.isPattern(/^questions\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/))

const isWorkspaceMarkdownPath = (path: string): boolean =>
  path.endsWith('.md') &&
  !path.startsWith('/') &&
  !path.includes('\\') &&
  !path.includes('\0') &&
  path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')

export const workspaceMarkdownPathSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.makeFilter(path => (isWorkspaceMarkdownPath(path) ? undefined : 'Expected a safe workspace-relative Markdown path.')),
)

export const markdownFeedbackAnchorSchema = Schema.Struct({
  kind: Schema.Literal('markdown'),
  path: workspaceMarkdownPathSchema,
  revision: sha256Schema,
  startLine: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  endLine: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  excerpt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_000)),
}).check(
  Schema.makeFilter(anchor =>
    anchor.endLine >= anchor.startLine && anchor.endLine - anchor.startLine < 200
      ? undefined
      : { path: ['endLine'], issue: 'Markdown feedback anchors must cover at most 200 ordered lines.' },
  ),
)

export const feedbackResolutionReceiptSchema = Schema.Struct({
  disposition: Schema.Literals(['accepted', 'rejected', 'deferred']),
  note: Schema.optionalKey(trimmedString(1, 4_000)),
  baseRevision: sha256Schema,
  observedRevision: Schema.NullOr(sha256Schema),
  checkedAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})

export const revisionedFeedbackRecordEffectSchema = Schema.Struct({
  feedbackId: Schema.String.check(Schema.isUUID()),
  parentSessionId: sessionIdSchema,
  childSessionId: sessionIdSchema,
  operationId: trimmedString(1, 256),
  anchor: markdownFeedbackAnchorSchema,
  comment: trimmedString(1, 4_000),
  status: Schema.Literals(['pending', 'resolved', 'stale', 'cancelled', 'delivery-failed']),
  notificationMessageId: Schema.optionalKey(trimmedString(1, 256)),
  resolutionReceipt: Schema.optionalKey(feedbackResolutionReceiptSchema),
  createdAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  updatedAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
}).check(
  Schema.makeFilter(record => {
    const issues: Array<Schema.FilterIssue> = []
    const hasReceipt = record.status === 'resolved' || record.status === 'stale'
    if (hasReceipt !== (record.resolutionReceipt !== undefined)) {
      issues.push({ path: ['resolutionReceipt'], issue: 'Resolved and stale feedback require a resolution receipt.' })
    }
    if (record.status === 'resolved' && record.resolutionReceipt?.observedRevision !== record.anchor.revision) {
      issues.push({ path: ['resolutionReceipt', 'observedRevision'], issue: 'Resolved feedback must match the anchored document revision.' })
    }
    if (record.status === 'stale' && record.resolutionReceipt?.observedRevision === record.anchor.revision) {
      issues.push({ path: ['resolutionReceipt', 'observedRevision'], issue: 'Stale feedback cannot match the anchored document revision.' })
    }
    return issues
  }),
)

export const parentQuestionRecordEffectSchema = Schema.Struct({
  questionId: Schema.String.check(Schema.isUUID()),
  parentSessionId: sessionIdSchema,
  childSessionId: sessionIdSchema,
  operationId: trimmedString(1, 256),
  question: trimmedString(1, 4_000),
  context: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(16_000))),
  options: parentQuestionOptionsSchema,
  recommendedOptionId: Schema.optionalKey(trimmedString(1, 80)),
  expiryBehavior: Schema.optionalKey(parentQuestionExpiryBehaviorSchema),
  status: Schema.Literals(['pending', 'answered', 'recommended', 'deferred', 'cancelled', 'expired', 'delivery-failed']),
  answer: Schema.optionalKey(trimmedString(1, 4_000)),
  deferredFilePath: Schema.optionalKey(deferredFilePathSchema),
  notificationMessageId: Schema.optionalKey(trimmedString(1, 256)),
  createdAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  expiresAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  updatedAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
}).check(
  Schema.makeFilter(record => {
    const issues: Array<Schema.FilterIssue> = []
    if (record.status === 'answered' && record.answer === undefined) {
      issues.push({ path: ['answer'], issue: 'Answered questions require an answer.' })
    }
    if (record.status !== 'answered' && record.answer !== undefined) {
      issues.push({ path: ['answer'], issue: 'Only answered questions retain an answer.' })
    }
    if ((record.recommendedOptionId === undefined) !== (record.expiryBehavior === undefined)) {
      issues.push({ path: ['recommendedOptionId'], issue: 'Recommendation and expiry behavior must be stored together.' })
    }
    if (record.recommendedOptionId !== undefined && !record.options.some(option => option.id === record.recommendedOptionId)) {
      issues.push({ path: ['recommendedOptionId'], issue: 'The recommended option must exist in the question options.' })
    }
    if (record.status === 'recommended' && record.expiryBehavior !== 'recommended') {
      issues.push({ path: ['expiryBehavior'], issue: 'Recommended outcomes require the recommended expiry behavior.' })
    }
    if (record.status === 'deferred' && record.expiryBehavior !== 'defer') {
      issues.push({ path: ['expiryBehavior'], issue: 'Deferred outcomes require the defer expiry behavior.' })
    }
    if (record.deferredFilePath !== undefined && record.status !== 'deferred') {
      issues.push({ path: ['deferredFilePath'], issue: 'Only deferred questions can retain a deferred file path.' })
    }
    return issues
  }),
)

export const parentQuestionRecordSchema = zodSchemaFromEffect(parentQuestionRecordEffectSchema)
export const revisionedFeedbackRecordSchema = zodSchemaFromEffect(revisionedFeedbackRecordEffectSchema)

export type ParentQuestionOption = typeof parentQuestionOptionSchema.Type
export type ParentQuestionRecord = typeof parentQuestionRecordEffectSchema.Type
export type ParentQuestionTable = KvTable<string, ParentQuestionRecord>
export type MarkdownFeedbackAnchor = typeof markdownFeedbackAnchorSchema.Type
export type FeedbackResolutionReceipt = typeof feedbackResolutionReceiptSchema.Type
export type RevisionedFeedbackRecord = typeof revisionedFeedbackRecordEffectSchema.Type
export type RevisionedFeedbackTable = KvTable<string, RevisionedFeedbackRecord>

export const parentQuestionDomain = defineDomain({
  name: 'dshfiles_agent_questions',
  version: 3,
  compatibleVersions: [1, 2],
  layout: 'per-record',
  tables: {
    questions: {
      valueSchema: parentQuestionRecordSchema,
      __key: 'questions',
    },
    feedback: {
      valueSchema: revisionedFeedbackRecordSchema,
      __key: 'feedback',
    },
  },
})
