import { z } from 'zod'
import { jobCategoryValues } from './classify.js'

export const jobCategorySchema = z.enum(jobCategoryValues)
export const jobStatusSchema = z.enum(['running', 'stopping', 'completed', 'killed', 'failed', 'interrupted'])
export type JobStatus = z.infer<typeof jobStatusSchema>
export const jobScopeSchema = z.enum(['running', 'finished', 'all'])
export type JobScope = z.infer<typeof jobScopeSchema>

export const jobSessionSchema = z
  .object({
    id: z.string().min(1).max(256),
    title: z.string().max(300).nullable(),
    cwd: z.string().max(1000).nullable(),
    project: z.string().max(300).nullable(),
  })
  .strict()
export type JobSession = z.infer<typeof jobSessionSchema>

export const jobRowSchema = z
  .object({
    id: z.string().min(1).max(128),
    kind: z.string().min(1).max(64),
    label: z.string().max(2000),
    owner: z.string().min(1).max(256).nullable(),
    status: jobStatusSchema,
    progress: z.string().max(300).nullable(),
    detail: z.string().max(500).nullable(),
    startedAt: z.number().int().nonnegative(),
    finishedAt: z.number().int().nonnegative().nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    category: jobCategorySchema,
    live: z.boolean(),
    outputTotal: z.number().int().nonnegative(),
    spillPaths: z.array(z.string().max(1000)).max(8),
  })
  .strict()
export type JobRow = z.infer<typeof jobRowSchema>

export const jobBoardFilterSchema = z
  .object({
    scope: jobScopeSchema.optional().describe('running (default), finished, or all.'),
    categories: z.array(jobCategorySchema).max(jobCategoryValues.length).optional().describe('Only jobs in these categories.'),
    sessionId: z.string().min(1).max(256).optional().describe('Only jobs owned by this Session.'),
    search: z.string().trim().min(1).max(200).optional().describe('Case-insensitive literal search over the label, kind, id, and status detail.'),
    cursor: z.string().min(1).max(256).optional().describe('Opaque cursor from a previous page.'),
    limit: z.number().int().min(1).max(200).optional().describe('Rows per page, 1 to 200; defaults to 100.'),
  })
  .strict()
export type JobBoardFilter = z.infer<typeof jobBoardFilterSchema>

export const jobIndexingSchema = z
  .object({
    active: z.boolean(),
    caughtUp: z.boolean(),
    files: z.number().int().nonnegative(),
    indexedFiles: z.number().int().nonnegative(),
    historyRows: z.number().int().nonnegative(),
    lastIndexedAt: z.number().int().nonnegative().nullable(),
    lastError: z.string().max(500).nullable(),
  })
  .strict()
export type JobIndexing = z.infer<typeof jobIndexingSchema>

export const jobBoardSchema = z
  .object({
    rows: z.array(jobRowSchema).max(200),
    total: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextCursor: z.string().min(1).max(256).nullable(),
    categoryCounts: z.record(jobCategorySchema, z.number().int().nonnegative()),
    runningCount: z.number().int().nonnegative(),
    finishedCount: z.number().int().nonnegative(),
    sessions: z.array(jobSessionSchema).max(200),
    indexing: jobIndexingSchema,
    liveAvailable: z.boolean(),
    generatedAt: z.number().int().nonnegative(),
  })
  .strict()
export type JobBoard = z.infer<typeof jobBoardSchema>

export const jobOutputSchema = z
  .object({
    jobId: z.string().min(1).max(128),
    available: z.boolean(),
    reason: z.string().max(300).nullable(),
    chunks: z
      .array(
        z
          .object({
            at: z.number().int().nonnegative(),
            channel: z.string().max(32).nullable(),
            text: z.string().max(20000),
          })
          .strict(),
      )
      .max(200),
    next: z.number().int().nonnegative(),
    lossy: z.boolean(),
    spilled: z.array(z.string().max(1000)).max(8),
  })
  .strict()
export type JobOutput = z.infer<typeof jobOutputSchema>

export const jobKillSchema = z
  .object({
    jobId: z.string().min(1).max(128),
    outcome: z.enum(['requested', 'already-finished']),
  })
  .strict()
export type JobKill = z.infer<typeof jobKillSchema>

/** One job as the session log recorded it; live state is layered on top at read time. */
export const historyJobSchema = z
  .object({
    id: z.string().min(1).max(128),
    kind: z.string().min(1).max(64),
    label: z.string().max(2000),
    owner: z.string().min(1).max(256).nullable(),
    startedAt: z.number().int().nonnegative(),
    settled: z.boolean(),
    status: z.enum(['completed', 'killed', 'failed']).nullable(),
    cause: z.string().max(32).nullable(),
    detail: z.string().max(500).nullable(),
    finishedAt: z.number().int().nonnegative().nullable(),
  })
  .strict()
export type HistoryJob = z.infer<typeof historyJobSchema>

export const jobStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    offsets: z.record(z.string(), z.number().int().nonnegative()),
    jobs: z.record(z.string(), historyJobSchema),
    sessions: z.record(z.string(), jobSessionSchema),
    startedAt: z.number().int().nonnegative(),
  })
  .strict()
export type JobState = z.infer<typeof jobStateSchema>
