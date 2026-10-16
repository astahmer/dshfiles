import { z } from 'zod'
import type { StoredReceipt } from './store.js'

const revisionSchema = z.string().regex(/^[a-f0-9]{40,64}$/).nullable()

export const projectChecksActivitySummarySchema = z
  .object({
    receiptId: z.string().uuid(),
    sessionId: z.string().min(1).max(128),
    actionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
    label: z.string().min(1).max(80).regex(/^[^\u0000-\u001f\u007f]+$/),
    status: z.enum(['passed', 'failed', 'cancelled', 'timed-out']),
    failure: z.enum(['spawn-failed', 'process-group-failed', 'revision-unavailable', 'source-changed']).nullable(),
    startedAt: z.number().int().nonnegative(),
    finishedAt: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    exitCode: z.number().int().nullable(),
    automatic: z.boolean(),
    verificationTurn: z.number().int().nonnegative().nullable(),
    attempt: z.number().int().min(0).max(2),
    sourceRevisionBefore: revisionSchema,
    sourceRevisionAfter: revisionSchema,
  })
  .strict()

export const projectChecksActivityEventSchema = z
  .object({
    kind: z.literal('verification-receipt'),
    version: z.literal(1),
    value: projectChecksActivitySummarySchema,
  })
  .strict()

export type ProjectChecksActivityEvent = z.infer<typeof projectChecksActivityEventSchema>

export const projectChecksActivityEvent = (receipt: StoredReceipt): ProjectChecksActivityEvent =>
  projectChecksActivityEventSchema.parse({
    kind: 'verification-receipt',
    version: 1,
    value: {
      receiptId: receipt.id,
      sessionId: receipt.sessionId,
      actionId: receipt.actionId,
      label: receipt.label.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || receipt.actionId,
      status: receipt.status,
      failure: receipt.failure,
      startedAt: receipt.startedAt,
      finishedAt: receipt.finishedAt,
      durationMs: receipt.durationMs,
      exitCode: receipt.exitCode,
      automatic: receipt.automatic,
      verificationTurn: receipt.verificationTurn,
      attempt: receipt.attempt,
      sourceRevisionBefore: receipt.sourceRevisionBefore ?? null,
      sourceRevisionAfter: receipt.sourceRevisionAfter === undefined ? receipt.sourceRevision : receipt.sourceRevisionAfter,
    },
  })

export const emitProjectChecksActivity = (receipt: StoredReceipt, emit: (event: ProjectChecksActivityEvent) => void): void => {
  try {
    emit(projectChecksActivityEvent(receipt))
  } catch {
    return
  }
}

export const persistReceiptAndEmitActivity = async (input: {
  readonly receipt: StoredReceipt
  readonly persist: () => Promise<void>
  readonly emit: (event: ProjectChecksActivityEvent) => void
}): Promise<void> => {
  await input.persist()
  emitProjectChecksActivity(input.receipt, input.emit)
}
