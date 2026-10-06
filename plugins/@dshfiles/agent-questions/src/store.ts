import { defineDomain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export const parentQuestionOptionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
}).strict()

export const parentQuestionOptionsSchema = z.array(parentQuestionOptionSchema)
  .min(2)
  .max(8)
  .refine(options => new Set(options.map(option => option.id)).size === options.length)

export const parentQuestionExpiryBehaviorSchema = z.enum(['recommended', 'defer'])
export type ParentQuestionExpiryBehavior = z.infer<typeof parentQuestionExpiryBehaviorSchema>

export const deferredFilePathSchema = z.string()
  .regex(/^questions\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/)

export const parentQuestionRecordSchema = z.object({
  questionId: z.string().uuid(),
  parentSessionId: z.string().trim().min(1).max(256),
  childSessionId: z.string().trim().min(1).max(256),
  operationId: z.string().trim().min(1).max(256),
  question: z.string().trim().min(1).max(4_000),
  context: z.string().max(16_000).optional(),
  options: parentQuestionOptionsSchema,
  recommendedOptionId: z.string().trim().min(1).max(80).optional(),
  expiryBehavior: parentQuestionExpiryBehaviorSchema.optional(),
  status: z.enum([
    'pending',
    'answered',
    'recommended',
    'deferred',
    'cancelled',
    'expired',
    'delivery-failed',
  ]),
  answer: z.string().trim().min(1).max(4_000).optional(),
  deferredFilePath: deferredFilePathSchema.optional(),
  notificationMessageId: z.string().trim().min(1).max(256).optional(),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict().superRefine((record, context) => {
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
  if (record.recommendedOptionId !== undefined
    && !record.options.some(option => option.id === record.recommendedOptionId)) {
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

export const parentQuestionDomain = defineDomain({
  name: 'dshfiles_agent_questions',
  version: 2,
  compatibleVersions: [1],
  layout: 'per-record',
  tables: {
    questions: {
      valueSchema: parentQuestionRecordSchema,
      __key: 'questions',
    },
  },
})
