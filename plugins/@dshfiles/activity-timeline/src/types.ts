import { z } from 'zod'

const revisionEvidenceSchema = z
  .string()
  .regex(/^[a-f0-9]{40,64}$/)
  .nullable()

export const verificationReceiptSummarySchema = z
  .object({
    receiptId: z.string().uuid(),
    sessionId: z.string().min(1).max(128),
    actionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
    label: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[^\p{Cc}]+$/u),
    status: z.enum(['passed', 'failed', 'cancelled', 'timed-out']),
    failure: z.enum(['spawn-failed', 'process-group-failed', 'revision-unavailable', 'source-changed', 'remote-unavailable', 'remote-failed']).nullable(),
    executor: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('local') }).strict(),
        z
          .object({
            kind: z.literal('remote'),
            remoteId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
            sshTarget: z.string().max(255),
            workspace: z.string().max(2048),
          })
          .strict(),
      ])
      .optional(),
    remoteFailure: z
      .object({
        remoteId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
        code: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        message: z.string().max(240),
      })
      .strict()
      .nullable()
      .optional(),
    startedAt: z.number().int().nonnegative(),
    finishedAt: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    exitCode: z.number().int().nullable(),
    automatic: z.boolean(),
    verificationTurn: z.number().int().nonnegative().nullable(),
    attempt: z.number().int().min(0).max(2),
    sourceRevisionBefore: revisionEvidenceSchema,
    sourceRevisionAfter: revisionEvidenceSchema,
  })
  .strict()
export type VerificationReceiptSummary = z.infer<typeof verificationReceiptSummarySchema>

export const verificationReceiptEventSchema = z
  .object({
    kind: z.literal('verification-receipt'),
    version: z.literal(1),
    value: verificationReceiptSummarySchema,
  })
  .strict()

export const activitySourceSchema = z.enum(['session', 'communication', 'integration', 'workspace', 'system'])
export type ActivitySource = z.infer<typeof activitySourceSchema>

export const activityLevelSchema = z.enum(['routine', 'notable', 'attention'])
export type ActivityLevel = z.infer<typeof activityLevelSchema>

export const activityReferenceSchema = z
  .object({
    kind: z.enum(['session', 'workspace', 'integration-candidate', 'message', 'revision']),
    id: z.string().min(1).max(256),
    label: z.string().max(200).nullable(),
  })
  .strict()
export type ActivityReference = z.infer<typeof activityReferenceSchema>

export const activityEventSchema = z
  .object({
    id: z.string().min(1).max(256),
    at: z.number().int().nonnegative(),
    source: activitySourceSchema,
    type: z.string().min(1).max(80),
    level: activityLevelSchema,
    sessionId: z.string().min(1).max(256).nullable(),
    workspaceId: z.string().min(1).max(256).nullable(),
    taskId: z.string().min(1).max(256).nullable(),
    correlationId: z.string().min(1).max(128).nullable(),
    causationId: z.string().min(1).max(256).nullable(),
    summary: z.string().min(1).max(500),
    detail: z.string().max(2000).nullable(),
    metadata: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])),
    references: z.array(activityReferenceSchema).max(8),
    provenance: z.enum(['observed', 'reported']),
  })
  .strict()
export type ActivityEvent = z.infer<typeof activityEventSchema>

export const activityIngestSchema = activityEventSchema
  .partial({
    level: true,
    sessionId: true,
    workspaceId: true,
    taskId: true,
    correlationId: true,
    causationId: true,
    detail: true,
    metadata: true,
    references: true,
    provenance: true,
  })
  .extend({
    id: z.string().min(1).max(256),
    at: z.number().int().nonnegative(),
    source: activitySourceSchema,
    type: z.string().min(1).max(80),
    summary: z.string().min(1).max(500),
  })
export type ActivityIngest = z.infer<typeof activityIngestSchema>

export const condensedItemSchema = z
  .object({
    kind: z.enum(['event', 'group']),
    id: z.string().min(1).max(256),
    at: z.number().int().nonnegative(),
    source: activitySourceSchema,
    type: z.string().min(1).max(80),
    level: activityLevelSchema,
    sessionId: z.string().min(1).max(256).nullable(),
    correlationId: z.string().min(1).max(128).nullable(),
    summary: z.string().min(1).max(500),
    count: z.number().int().positive(),
    eventIds: z.array(z.string().min(1).max(256)).max(500),
    references: z.array(activityReferenceSchema).max(8),
  })
  .strict()
export type CondensedItem = z.infer<typeof condensedItemSchema>

export const activityPageSchema = z
  .object({
    items: z.array(condensedItemSchema).max(200),
    nextCursor: z.string().min(1).max(256).nullable(),
    hasMore: z.boolean(),
    newestAt: z.number().int().nonnegative().nullable(),
    attentionCount: z.number().int().nonnegative(),
    totalRetained: z.number().int().nonnegative(),
  })
  .strict()
export type ActivityPage = z.infer<typeof activityPageSchema>

export const activityFilterSchema = z
  .object({
    sources: z.array(activitySourceSchema).max(4).optional(),
    levels: z.array(activityLevelSchema).max(3).optional(),
    sessionId: z.string().min(1).max(256).optional(),
    correlationId: z.string().min(1).max(128).optional(),
    search: z.string().trim().min(1).max(120).optional(),
    detailed: z.boolean().optional(),
    cursor: z.string().min(1).max(256).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    before: z.number().int().nonnegative().optional(),
  })
  .strict()
export type ActivityFilter = z.infer<typeof activityFilterSchema>

export const activityStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    events: z.array(activityEventSchema).max(5000),
    ingestCount: z.number().int().nonnegative(),
    duplicateCount: z.number().int().nonnegative(),
    startedAt: z.number().int().nonnegative(),
  })
  .strict()
export type ActivityState = z.infer<typeof activityStateSchema>

/** The `backlog` payload of `dshfiles/activity/event`, as `@dshfiles/backlog` emits it. */
export const backlogActivitySchema = z
  .object({
    id: z.string().min(1).max(256),
    at: z.number().int().nonnegative(),
    type: z.enum(['backlog.created', 'backlog.moved', 'backlog.linked', 'backlog.commented', 'backlog.attention', 'backlog.triaged']),
    level: activityLevelSchema,
    summary: z.string().min(1).max(500),
    detail: z.string().max(2000).nullable(),
    itemId: z.number().int().positive(),
    sessionId: z.string().min(1).max(256).nullable(),
    revision: z.string().min(1).max(256).nullable(),
  })
  .strict()
export type BacklogActivityInput = z.infer<typeof backlogActivitySchema>
