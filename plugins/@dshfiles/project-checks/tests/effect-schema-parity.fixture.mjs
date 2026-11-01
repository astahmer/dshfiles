import * as EffectSchema from 'effect/Schema'
import { z } from 'zod'
import {
  actionsInputSchema,
  cancelTaskInputSchema,
  candidateVerificationResultSchema,
  completionAuthorizationResultSchema,
  hookEventSchema,
  hookEventsInputSchema,
  hookEventsOutputSchema,
  receiptsInputSchema,
  retryTaskInputSchema,
  runInputSchema,
} from '../src/api-effect-schemas.ts'

const Schema = {
  ...EffectSchema,
  toJsonSchemaDocument: (schema, options) => EffectSchema.toJsonSchemaDocument(schema, { ...options, onExcessProperty: 'error' }),
}

const sessionIdSchema = z.string().min(1).max(128)
const actionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
const taskIdSchema = z.string().regex(/^[a-f0-9]{64}$/)
const optionalSessionInput = z.object({ sessionId: sessionIdSchema.optional() })
const zodHookEvent = z.object({
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

const hookEvent = {
  seq: 12,
  time: 1_234,
  kind: 'result',
  turn: 1,
  point: 'Stop',
  dialect: null,
  decision: 'pass',
  exitCode: 0,
  durationMs: 12.5,
  stderrPresent: false,
}

const fixtures = [
  { name: 'actions input', zod: optionalSessionInput, effect: actionsInputSchema, input: { sessionId: 'session-1' } },
  { name: 'receipts input', zod: optionalSessionInput, effect: receiptsInputSchema, input: {} },
  { name: 'hook events input', zod: optionalSessionInput, effect: hookEventsInputSchema, input: {} },
  {
    name: 'run input',
    zod: z.object({ sessionId: sessionIdSchema.optional(), actionId: actionIdSchema }),
    effect: runInputSchema,
    input: { sessionId: 'session-1', actionId: 'typecheck' },
  },
  {
    name: 'cancel task input',
    zod: z.object({ sessionId: sessionIdSchema.optional(), taskId: taskIdSchema }).strict(),
    effect: cancelTaskInputSchema,
    input: { taskId: 'a'.repeat(64) },
  },
  {
    name: 'retry task input',
    zod: z.object({ sessionId: sessionIdSchema.optional(), taskId: taskIdSchema, confirmPossibleDuplicate: z.literal(true) }).strict(),
    effect: retryTaskInputSchema,
    input: { taskId: 'a'.repeat(64), confirmPossibleDuplicate: true },
  },
  {
    name: 'completion authorization result',
    zod: z.object({ status: z.enum(['authorized', 'unavailable']) }).strict(),
    effect: completionAuthorizationResultSchema,
    input: { status: 'authorized' },
  },
  {
    name: 'candidate verification result',
    zod: z
      .object({ status: z.enum(['passed', 'failed', 'stale', 'cancelled', 'unavailable', 'attempt-limit']), prompt: z.string().max(2_048).nullable() })
      .strict(),
    effect: candidateVerificationResultSchema,
    input: { status: 'failed', prompt: 'Typecheck failed.' },
  },
  { name: 'hook event', zod: zodHookEvent, effect: hookEventSchema, input: hookEvent },
  { name: 'hook events output', zod: z.array(zodHookEvent).max(12), effect: hookEventsOutputSchema, input: [hookEvent] },
]

export { Schema, fixtures, z }
