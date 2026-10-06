import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const sessionIdSchema = z.string().min(1).max(128)
const actionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/)

export const actionViewSchema = z.object({
  id: actionIdSchema,
  label: z.string().max(80),
  description: z.string().max(240),
  timeoutMs: z.number().int().min(1_000).max(300_000),
  verifyBeforeComplete: z.boolean(),
})

export const receiptSchema = z.object({
  id: z.string().uuid(),
  sessionId: sessionIdSchema,
  actionId: actionIdSchema,
  label: z.string().max(80),
  status: z.enum(['passed', 'failed', 'cancelled', 'timed-out']),
  failure: z.enum(['spawn-failed', 'process-group-failed', 'revision-unavailable', 'source-changed']).nullable(),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable(),
  sourceRevision: z
    .string()
    .regex(/^[a-f0-9]{40,64}$/)
    .nullable(),
  verificationTurn: z.number().int().nonnegative().nullable(),
  automatic: z.boolean(),
  attempt: z.number().int().min(0).max(2),
  freshness: z.enum(['current', 'stale', 'unknown']),
})

export const hookEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  time: z.number().int().nonnegative(),
  kind: z.enum(['invoked', 'result']),
  turn: z.number().int().nonnegative(),
  point: z.string().max(120),
  dialect: z.enum(['claude-code', 'codex']).nullable(),
  decision: z.string().max(40).nullable(),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  stderrPresent: z.boolean(),
})

export const projectChecksApi = defineApi({
  id: 'project-checks',
  version: 1,
  methods: {
    actions: method({
      input: z.object({ sessionId: sessionIdSchema }),
      output: z.array(actionViewSchema).max(32),
    }),
    receipts: method({
      input: z.object({ sessionId: sessionIdSchema }),
      output: z.array(receiptSchema).max(30),
    }),
    hookEvents: method({
      input: z.object({ sessionId: sessionIdSchema }),
      output: z.array(hookEventSchema).max(12),
    }),
    run: method({
      input: z.object({ sessionId: sessionIdSchema, actionId: actionIdSchema }),
      output: receiptSchema,
    }),
  },
})

export type ProjectActionView = z.infer<typeof actionViewSchema>
export type ProjectCheckReceipt = z.infer<typeof receiptSchema>
export type ProjectHookEvent = z.infer<typeof hookEventSchema>

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dshfiles-project-checks': { readonly kind: 'dshfiles-project-checks' }
  }
}
