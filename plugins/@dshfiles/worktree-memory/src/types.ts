import { Effect, Schema } from 'effect'

export const processCategoryValues = ['dev-server', 'tests', 'build', 'dsh', 'services', 'other'] as const
export type ProcessCategory = (typeof processCategoryValues)[number]

export const emptyCategoryBytes = () => ({ 'dev-server': 0, tests: 0, build: 0, dsh: 0, services: 0, other: 0 }) satisfies Record<ProcessCategory, number>

const memoryPressureValues = ['normal', 'warning', 'critical', 'unknown'] as const
export type MemoryPressure = (typeof memoryPressureValues)[number]

/**
 * - `job`: a live background job of this Host, matched to its process tree.
 * - `host`: a child of this Host no live job claims (terminal shells, tool helpers).
 * - `detached`: a process tree re-parented to init that still runs inside a workspace: a daemon a command started on
 *   purpose (`dshx dev up`), or one an earlier DSH process or a finished command left behind.
 */
const processOriginValues = ['job', 'host', 'detached'] as const
export type ProcessOrigin = (typeof processOriginValues)[number]

const positiveInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))
const nonNegativeInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const nonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))
const limitedString = (maxLength: number) => Schema.String.check(Schema.isMaxLength(maxLength))

const processTreeSchema = Schema.Struct({
  pid: positiveInt,
  startedAt: nonNegativeInt,
  name: limitedString(120),
  command: limitedString(400),
  cwd: limitedString(1024),
  bytes: nonNegativeNumber,
  processCount: positiveInt,
  origin: Schema.Literals(processOriginValues),
  category: Schema.Literals(processCategoryValues),
  jobId: Schema.NullOr(limitedString(128)),
  sessionId: Schema.NullOr(limitedString(128)),
  ownerRunning: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
    Schema.annotate({ description: 'A live job whose owning Session is mid-turn; a bulk stop leaves it to that thread’s own Stop.' }),
  ),
})
export type ProcessTree = typeof processTreeSchema.Type

const workspaceThreadSchema = Schema.Struct({
  sessionId: limitedString(128),
  title: Schema.NullOr(limitedString(300)),
  createdAt: Schema.optional(Schema.NullOr(Schema.Number)),
  running: Schema.Boolean,
  updatedAt: Schema.NullOr(Schema.Number),
})
export type WorkspaceThread = typeof workspaceThreadSchema.Type

/** `project` is a registered workspace; `workspace` a thread or jj sibling checkout of one; `elsewhere` collects Host children outside every workspace. */
const workspaceGroupKindValues = ['project', 'workspace', 'elsewhere'] as const

const workspaceGroupSchema = Schema.Struct({
  key: limitedString(1024),
  title: limitedString(300),
  path: limitedString(1024),
  kind: Schema.Literals(workspaceGroupKindValues),
  project: Schema.NullOr(limitedString(300)),
  bytes: nonNegativeNumber,
  detachedBytes: nonNegativeNumber,
  detachedCount: nonNegativeInt,
  threadCount: nonNegativeInt,
  threads: Schema.Array(workspaceThreadSchema).check(Schema.isMaxLength(20)),
  trees: Schema.Array(processTreeSchema).check(Schema.isMaxLength(200)),
})
export type WorkspaceGroup = typeof workspaceGroupSchema.Type

const nodeProcessSampleSchema = Schema.Struct({
  pid: positiveInt,
  rssBytes: nonNegativeNumber,
})
export type NodeProcessSample = typeof nodeProcessSampleSchema.Type

const nodeProcessOriginSchema = Schema.Struct({
  name: limitedString(120),
  source: Schema.NullOr(limitedString(120)),
  cwd: Schema.NullOr(limitedString(1024)),
  processCount: nonNegativeInt,
  rssBytes: nonNegativeNumber,
  samples: Schema.Array(nodeProcessSampleSchema).check(Schema.isMaxLength(5)),
})
export type NodeProcessOrigin = typeof nodeProcessOriginSchema.Type

const nodeProcessSummarySchema = Schema.Struct({
  processCount: nonNegativeInt,
  rssBytes: nonNegativeNumber,
  truncated: Schema.Boolean,
  origins: Schema.Array(nodeProcessOriginSchema).check(Schema.isMaxLength(100)),
})
export type NodeProcessSummary = typeof nodeProcessSummarySchema.Type

export const scratchKindValues = ['e2e', 'dev'] as const

const scratchOwnerSchema = Schema.Struct({
  pid: positiveInt,
  startedAt: nonNegativeNumber,
  workspace: limitedString(1024),
  kind: Schema.Literals(scratchKindValues),
  alive: Schema.Boolean,
})

/**
 * - `owner-gone`: a dshx scratch record names an owner whose pid is dead or now runs a process started at another time.
 * - `legacy-detached`: no record, re-parented to init and older than two hours (Hosts started before the record contract).
 */
const orphanReasonValues = ['owner-gone', 'legacy-detached'] as const
export type OrphanReason = (typeof orphanReasonValues)[number]

const scratchHostSchema = Schema.Struct({
  pid: positiveInt,
  startedAt: nonNegativeInt,
  port: Schema.NullOr(positiveInt),
  owner: Schema.NullOr(scratchOwnerSchema),
  orphan: Schema.Boolean,
  reason: Schema.NullOr(Schema.Literals(orphanReasonValues)),
  bytes: nonNegativeNumber,
  cpuPercent: nonNegativeNumber,
  processCount: positiveInt,
})
export type ScratchHost = typeof scratchHostSchema.Type

export const scratchHostsSchema = Schema.Struct({
  hosts: Schema.Array(scratchHostSchema).check(Schema.isMaxLength(200)),
  orphanCount: nonNegativeInt,
  orphanBytes: nonNegativeNumber,
  orphanCpuPercent: nonNegativeNumber,
  /** The settings thresholds: the status strip warns while orphans use at least this much CPU or memory. */
  alert: Schema.Struct({ cpuPercent: nonNegativeNumber, memoryBytes: nonNegativeNumber }),
})
export type ScratchHosts = typeof scratchHostsSchema.Type

export const stopOrphansResultSchema = Schema.Struct({
  stopped: nonNegativeInt,
  refused: nonNegativeInt,
  missing: nonNegativeInt,
})
export type StopOrphansResult = typeof stopOrphansResultSchema.Type

export const memorySnapshotSchema = Schema.Struct({
  takenAt: Schema.Number,
  supported: Schema.Boolean,
  pressure: Schema.Literals(memoryPressureValues),
  systemBytes: nonNegativeNumber,
  hostBytes: nonNegativeNumber,
  trackedBytes: nonNegativeNumber,
  detachedBytes: nonNegativeNumber,
  detachedCount: nonNegativeInt,
  categoryBytes: Schema.Record(Schema.Literals(processCategoryValues), nonNegativeNumber),
  groups: Schema.Array(workspaceGroupSchema).check(Schema.isMaxLength(200)),
  nodeProcesses: Schema.optional(nodeProcessSummarySchema),
  scratchHosts: Schema.optional(scratchHostsSchema),
})
export type MemorySnapshot = typeof memorySnapshotSchema.Type

export const pressureSnapshotSchema = Schema.Struct({
  takenAt: Schema.Number,
  supported: Schema.Boolean,
  pressure: Schema.Literals(memoryPressureValues),
  systemBytes: nonNegativeNumber,
})
export type PressureSnapshot = typeof pressureSnapshotSchema.Type

export const stopTargetSchema = Schema.Struct({
  pid: positiveInt.pipe(Schema.annotate({ description: 'Root pid of a process tree from the snapshot.' })),
  startedAt: nonNegativeInt.pipe(
    Schema.annotate({ description: 'The tree’s startedAt from the snapshot; a recycled pid with another start time is refused.' }),
  ),
})
export type StopTarget = typeof stopTargetSchema.Type

export const stopResultSchema = Schema.Struct({
  stopped: nonNegativeInt,
  viaJob: nonNegativeInt,
  missing: nonNegativeInt,
  refused: nonNegativeInt,
})
export type StopResult = typeof stopResultSchema.Type
