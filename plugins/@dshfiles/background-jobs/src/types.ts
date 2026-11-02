import { Schema } from 'effect'
import { jobCategoryValues } from './classify.js'

const boundedString = (minimum: number, maximum: number) => Schema.String.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum))
const boundedText = (maximum: number) => Schema.String.check(Schema.isMaxLength(maximum))
const nonnegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const boundedArray = <Item extends Schema.Constraint>(item: Item, maximum: number) => Schema.Array(item).check(Schema.isMaxLength(maximum))
const struct = <Fields extends Schema.Struct.Fields>(fields: Fields) => Schema.Struct(fields)

const jobCategorySchema = Schema.Literals(jobCategoryValues)
const jobStatusSchema = Schema.Literals(['running', 'stopping', 'completed', 'killed', 'failed', 'interrupted'])
export type JobStatus = Schema.Schema.Type<typeof jobStatusSchema>
const jobScopeSchema = Schema.Literals(['running', 'finished', 'all'])
export type JobScope = Schema.Schema.Type<typeof jobScopeSchema>

export const jobSessionSchema = struct({
  id: boundedString(1, 256),
  title: Schema.NullOr(boundedText(300)),
  cwd: Schema.NullOr(boundedText(1000)),
  project: Schema.NullOr(boundedText(300)),
})
export type JobSession = Schema.Schema.Type<typeof jobSessionSchema>

const jobRowSchema = struct({
  id: boundedString(1, 128),
  kind: boundedString(1, 64),
  label: boundedText(2000),
  owner: Schema.NullOr(boundedString(1, 256)),
  status: jobStatusSchema,
  progress: Schema.NullOr(boundedText(300)),
  detail: Schema.NullOr(boundedText(500)),
  startedAt: nonnegativeInteger,
  finishedAt: Schema.NullOr(nonnegativeInteger),
  durationMs: Schema.NullOr(nonnegativeInteger),
  category: jobCategorySchema,
  live: Schema.Boolean,
  outputTotal: nonnegativeInteger,
  spillPaths: boundedArray(boundedText(1000), 8),
})
export type JobRow = Schema.Schema.Type<typeof jobRowSchema>

export const jobBoardFilterSchema = struct({
  scope: Schema.optional(jobScopeSchema.annotate({ description: 'running (default), finished, or all.' })),
  categories: Schema.optional(boundedArray(jobCategorySchema, jobCategoryValues.length).annotate({ description: 'Only jobs in these categories.' })),
  sessionId: Schema.optional(boundedString(1, 256).annotate({ description: 'Only jobs owned by this Session.' })),
  search: Schema.optional(
    Schema.Trimmed.check(Schema.isMinLength(1), Schema.isMaxLength(200)).annotate({
      description: 'Case-insensitive literal search over the label, kind, id, and status detail.',
    }),
  ),
  cursor: Schema.optional(boundedString(1, 256).annotate({ description: 'Opaque cursor from a previous page.' })),
  limit: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200)).annotate({
      description: 'Rows per page, 1 to 200; defaults to 100.',
    }),
  ),
})
export type JobBoardFilter = Schema.Schema.Type<typeof jobBoardFilterSchema>

export const jobIndexingSchema = struct({
  active: Schema.Boolean,
  caughtUp: Schema.Boolean,
  files: nonnegativeInteger,
  indexedFiles: nonnegativeInteger,
  historyRows: nonnegativeInteger,
  lastIndexedAt: Schema.NullOr(nonnegativeInteger),
  lastError: Schema.NullOr(boundedText(500)),
})
export type JobIndexing = Schema.Schema.Type<typeof jobIndexingSchema>

export const jobBoardSchema = struct({
  rows: boundedArray(jobRowSchema, 200),
  total: nonnegativeInteger,
  hasMore: Schema.Boolean,
  nextCursor: Schema.NullOr(boundedString(1, 256)),
  categoryCounts: Schema.Record(jobCategorySchema, nonnegativeInteger),
  runningCount: nonnegativeInteger,
  finishedCount: nonnegativeInteger,
  sessions: boundedArray(jobSessionSchema, 200),
  indexing: jobIndexingSchema,
  liveAvailable: Schema.Boolean,
  generatedAt: nonnegativeInteger,
})
export type JobBoard = Schema.Schema.Type<typeof jobBoardSchema>

export const jobOutputSchema = struct({
  jobId: boundedString(1, 128),
  available: Schema.Boolean,
  reason: Schema.NullOr(boundedText(300)),
  chunks: boundedArray(
    struct({
      at: nonnegativeInteger,
      channel: Schema.NullOr(boundedText(32)),
      text: boundedText(20_000),
    }),
    200,
  ),
  next: nonnegativeInteger,
  lossy: Schema.Boolean,
  spilled: boundedArray(boundedText(1000), 8),
})
export type JobOutput = Schema.Schema.Type<typeof jobOutputSchema>

export const jobKillSchema = struct({
  jobId: boundedString(1, 128),
  outcome: Schema.Literals(['requested', 'already-finished']),
})
export type JobKill = Schema.Schema.Type<typeof jobKillSchema>

export const jobWaitInputSchema = struct({
  jobIds: Schema.optional(
    boundedArray(boundedString(1, 128), 20).annotate({ description: 'Job ids to wait for; omit to wait for everything running when the call starts.' }),
  ),
  until: Schema.optional(
    Schema.Literals(['settled', 'any-settled']).annotate({
      description: 'settled (default): every target finished. any-settled: stop when the first target finishes.',
    }),
  ),
  timeoutMs: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1_000), Schema.isLessThanOrEqualTo(3_600_000)).annotate({
      description: 'Maximum wait in milliseconds; defaults to 300000 (5 minutes).',
    }),
  ),
})
export type JobWaitInput = Schema.Schema.Type<typeof jobWaitInputSchema>

export const jobWaitSchema = struct({
  startedAt: nonnegativeInteger,
  waitedMs: nonnegativeInteger,
  timeoutMs: nonnegativeInteger,
  until: Schema.Literals(['settled', 'any-settled']),
  timedOut: Schema.Boolean,
  jobs: boundedArray(
    struct({
      jobId: boundedString(1, 128),
      status: Schema.NullOr(jobStatusSchema),
      settled: Schema.Boolean,
      label: Schema.NullOr(boundedText(2000)),
      category: Schema.NullOr(jobCategorySchema),
    }),
    20,
  ),
  running: boundedArray(boundedString(1, 128), 20),
})
export type JobWait = Schema.Schema.Type<typeof jobWaitSchema>

/** One job as the session log recorded it; live state is layered on top at read time. */
export const historyJobSchema = struct({
  id: boundedString(1, 128),
  kind: boundedString(1, 64),
  label: boundedText(2000),
  owner: Schema.NullOr(boundedString(1, 256)),
  startedAt: nonnegativeInteger,
  settled: Schema.Boolean,
  status: Schema.NullOr(Schema.Literals(['completed', 'killed', 'failed'])),
  cause: Schema.NullOr(boundedText(32)),
  detail: Schema.NullOr(boundedText(500)),
  finishedAt: Schema.NullOr(nonnegativeInteger),
})
export type HistoryJob = Schema.Schema.Type<typeof historyJobSchema>

export const jobStateSchema = struct({
  schemaVersion: Schema.Literal(1),
  offsets: Schema.Record(Schema.String, nonnegativeInteger),
  jobs: Schema.Record(Schema.String, historyJobSchema),
  sessions: Schema.Record(Schema.String, jobSessionSchema),
  startedAt: nonnegativeInteger,
})
export type JobState = Schema.Schema.Type<typeof jobStateSchema>
