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

export const parentQuestionRecordSchema = z.object({
  questionId: z.string().uuid(),
  parentSessionId: z.string().trim().min(1).max(256),
  childSessionId: z.string().trim().min(1).max(256),
  operationId: z.string().trim().min(1).max(256),
  question: z.string().trim().min(1).max(4_000),
  context: z.string().max(16_000).optional(),
  options: parentQuestionOptionsSchema,
  status: z.enum(['pending', 'answered', 'cancelled', 'expired', 'delivery-failed']),
  answer: z.string().trim().min(1).max(4_000).optional(),
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
})

export type ParentQuestionOption = z.infer<typeof parentQuestionOptionSchema>
export type ParentQuestionRecord = z.infer<typeof parentQuestionRecordSchema>
export type ParentQuestionTable = KvTable<string, ParentQuestionRecord>

export const parentQuestionDomain = defineDomain({
  name: 'dshfiles_agent_questions',
  version: 1,
  layout: 'per-record',
  tables: {
    questions: {
      valueSchema: parentQuestionRecordSchema,
      __key: 'questions',
    },
  },
})
