import { defineDomain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export const parentQuestionOptionSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict()

export const parentQuestionOptionsSchema = z
  .array(parentQuestionOptionSchema)
  .min(2)
  .max(8)
  .refine(options => new Set(options.map(option => option.id)).size === options.length)

export const parentQuestionExpiryBehaviorSchema = z.enum(['recommended', 'defer'])
export type ParentQuestionExpiryBehavior = z.infer<typeof parentQuestionExpiryBehaviorSchema>

export const deferredFilePathSchema = z.string().regex(/^questions\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/)

const isWorkspaceMarkdownPath = (path: string): boolean =>
  path.endsWith('.md') &&
  !path.startsWith('/') &&
  !path.includes('\\') &&
  !path.includes('\0') &&
  path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')

export const workspaceMarkdownPathSchema = z.string().min(1).max(512).refine(isWorkspaceMarkdownPath)

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export const markdownFeedbackAnchorSchema = z
  .object({
    kind: z.literal('markdown'),
    path: workspaceMarkdownPathSchema,
    revision: sha256Schema,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    excerpt: z.string().min(1).max(4_000),
  })
  .strict()
  .superRefine((anchor, context) => {
    if (anchor.endLine < anchor.startLine || anchor.endLine - anchor.startLine >= 200) {
      context.addIssue({
        code: 'custom',
        path: ['endLine'],
        message: 'Markdown feedback anchors must cover at most 200 ordered lines.',
      })
    }
  })

export const feedbackResolutionReceiptSchema = z
  .object({
    disposition: z.enum(['accepted', 'rejected', 'deferred']),
    note: z.string().trim().min(1).max(4_000).optional(),
    baseRevision: sha256Schema,
    observedRevision: sha256Schema.nullable(),
    checkedAt: z.number().int().nonnegative(),
  })
  .strict()

export const revisionedFeedbackRecordSchema = z
  .object({
    feedbackId: z.string().uuid(),
    parentSessionId: z.string().trim().min(1).max(256),
    childSessionId: z.string().trim().min(1).max(256),
    operationId: z.string().trim().min(1).max(256),
    anchor: markdownFeedbackAnchorSchema,
    comment: z.string().trim().min(1).max(4_000),
    status: z.enum(['pending', 'resolved', 'stale', 'cancelled', 'delivery-failed']),
    notificationMessageId: z.string().trim().min(1).max(256).optional(),
    resolutionReceipt: feedbackResolutionReceiptSchema.optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((record, context) => {
    if ((record.status === 'resolved' || record.status === 'stale') !== (record.resolutionReceipt !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['resolutionReceipt'],
        message: 'Resolved and stale feedback require a resolution receipt.',
      })
    }
    if (record.status === 'resolved' && record.resolutionReceipt?.observedRevision !== record.anchor.revision) {
      context.addIssue({
        code: 'custom',
        path: ['resolutionReceipt', 'observedRevision'],
        message: 'Resolved feedback must match the anchored document revision.',
      })
    }
    if (record.status === 'stale' && record.resolutionReceipt?.observedRevision === record.anchor.revision) {
      context.addIssue({
        code: 'custom',
        path: ['resolutionReceipt', 'observedRevision'],
        message: 'Stale feedback cannot match the anchored document revision.',
      })
    }
  })

export const parentQuestionRecordSchema = z
  .object({
    questionId: z.string().uuid(),
    parentSessionId: z.string().trim().min(1).max(256),
    childSessionId: z.string().trim().min(1).max(256),
    operationId: z.string().trim().min(1).max(256),
    question: z.string().trim().min(1).max(4_000),
    context: z.string().max(16_000).optional(),
    options: parentQuestionOptionsSchema,
    recommendedOptionId: z.string().trim().min(1).max(80).optional(),
    expiryBehavior: parentQuestionExpiryBehaviorSchema.optional(),
    status: z.enum(['pending', 'answered', 'recommended', 'deferred', 'cancelled', 'expired', 'delivery-failed']),
    answer: z.string().trim().min(1).max(4_000).optional(),
    deferredFilePath: deferredFilePathSchema.optional(),
    notificationMessageId: z.string().trim().min(1).max(256).optional(),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.status === 'answered' && record.answer === undefined) {
      context.addIssue({ code: 'custom', path: ['answer'], message: 'Answered questions require an answer.' })
    }
    if (record.status !== 'answered' && record.answer !== undefined) {
      context.addIssue({ code: 'custom', path: ['answer'], message: 'Only answered questions retain an answer.' })
    }
    if ((record.recommendedOptionId === undefined) !== (record.expiryBehavior === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['recommendedOptionId'],
        message: 'Recommendation and expiry behavior must be stored together.',
      })
    }
    if (record.recommendedOptionId !== undefined && !record.options.some(option => option.id === record.recommendedOptionId)) {
      context.addIssue({
        code: 'custom',
        path: ['recommendedOptionId'],
        message: 'The recommended option must exist in the question options.',
      })
    }
    if (record.status === 'recommended' && record.expiryBehavior !== 'recommended') {
      context.addIssue({
        code: 'custom',
        path: ['expiryBehavior'],
        message: 'Recommended outcomes require the recommended expiry behavior.',
      })
    }
    if (record.status === 'deferred' && record.expiryBehavior !== 'defer') {
      context.addIssue({
        code: 'custom',
        path: ['expiryBehavior'],
        message: 'Deferred outcomes require the defer expiry behavior.',
      })
    }
    if (record.deferredFilePath !== undefined && record.status !== 'deferred') {
      context.addIssue({
        code: 'custom',
        path: ['deferredFilePath'],
        message: 'Only deferred questions can retain a deferred file path.',
      })
    }
  })

export type ParentQuestionOption = z.infer<typeof parentQuestionOptionSchema>
export type ParentQuestionRecord = z.infer<typeof parentQuestionRecordSchema>
export type ParentQuestionTable = KvTable<string, ParentQuestionRecord>
export type MarkdownFeedbackAnchor = z.infer<typeof markdownFeedbackAnchorSchema>
export type FeedbackResolutionReceipt = z.infer<typeof feedbackResolutionReceiptSchema>
export type RevisionedFeedbackRecord = z.infer<typeof revisionedFeedbackRecordSchema>
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
