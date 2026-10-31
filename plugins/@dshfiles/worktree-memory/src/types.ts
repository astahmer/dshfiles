import { Effect, Schema } from 'effect'
import { exactStruct, publicSchema } from './schema.js'

type Mutable<Value> = Value extends readonly (infer Entry)[]
  ? Mutable<Entry>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
    : Value

const boundedString = (maximum: number) => Schema.String.check(Schema.isMaxLength(maximum))
const nonnegativeNumber = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const nonnegativeInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const positiveInteger = Schema.Int.check(Schema.isGreaterThan(0))

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

const processTreeSchema = exactStruct({
  pid: positiveInteger,
  startedAt: nonnegativeInteger,
  name: boundedString(120),
  command: boundedString(400),
  cwd: boundedString(1024),
  bytes: nonnegativeNumber,
  processCount: positiveInteger,
  origin: Schema.Literals(processOriginValues),
  category: Schema.Literals(processCategoryValues),
  jobId: Schema.NullOr(boundedString(128)),
  sessionId: Schema.NullOr(boundedString(128)),
  ownerRunning: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description: 'A live job whose owning Session is mid-turn; a bulk stop leaves it to that thread’s own Stop.',
  }),
})
export type ProcessTree = Mutable<Schema.Schema.Type<typeof processTreeSchema>>

const workspaceThreadSchema = exactStruct({
  sessionId: boundedString(128),
  title: Schema.NullOr(boundedString(300)),
  createdAt: Schema.NullOr(Schema.Finite).pipe(Schema.optionalKey),
  running: Schema.Boolean,
  updatedAt: Schema.NullOr(Schema.Finite),
})
export type WorkspaceThread = Mutable<Schema.Schema.Type<typeof workspaceThreadSchema>>

/** `project` is a registered workspace; `workspace` a thread or jj sibling checkout of one; `elsewhere` collects Host children outside every workspace. */
const workspaceGroupKindValues = ['project', 'workspace', 'elsewhere'] as const

const workspaceGroupSchema = exactStruct({
  key: boundedString(1024),
  title: boundedString(300),
  path: boundedString(1024),
  kind: Schema.Literals(workspaceGroupKindValues),
  project: Schema.NullOr(boundedString(300)),
  bytes: nonnegativeNumber,
  detachedBytes: nonnegativeNumber,
  detachedCount: nonnegativeInteger,
  threadCount: nonnegativeInteger,
  threads: Schema.mutable(Schema.Array(workspaceThreadSchema)).check(Schema.isMaxLength(20)),
  trees: Schema.mutable(Schema.Array(processTreeSchema)).check(Schema.isMaxLength(200)),
})
export type WorkspaceGroup = Mutable<Schema.Schema.Type<typeof workspaceGroupSchema>>

const nodeProcessSampleSchema = exactStruct({
  pid: positiveInteger,
  rssBytes: nonnegativeNumber,
})
export type NodeProcessSample = Mutable<Schema.Schema.Type<typeof nodeProcessSampleSchema>>

const nodeProcessOriginSchema = exactStruct({
  name: boundedString(120),
  source: Schema.NullOr(boundedString(120)),
  cwd: Schema.NullOr(boundedString(1024)),
  processCount: nonnegativeInteger,
  rssBytes: nonnegativeNumber,
  samples: Schema.mutable(Schema.Array(nodeProcessSampleSchema)).check(Schema.isMaxLength(5)),
})
export type NodeProcessOrigin = Mutable<Schema.Schema.Type<typeof nodeProcessOriginSchema>>

const nodeProcessSummarySchema = exactStruct({
  processCount: nonnegativeInteger,
  rssBytes: nonnegativeNumber,
  truncated: Schema.Boolean,
  origins: Schema.mutable(Schema.Array(nodeProcessOriginSchema)).check(Schema.isMaxLength(100)),
})
export type NodeProcessSummary = Mutable<Schema.Schema.Type<typeof nodeProcessSummarySchema>>

const categoryBytesSchema = Schema.Record(Schema.Literals(processCategoryValues), nonnegativeNumber).check(
  Schema.makeFilter(value =>
    Object.keys(value).every(key => processCategoryValues.some(category => category === key))
      ? undefined
      : 'Category bytes cannot contain unknown process categories.',
  ),
)

export const memorySnapshotSchema = publicSchema(exactStruct({
  takenAt: Schema.Finite,
  supported: Schema.Boolean,
  pressure: Schema.Literals(memoryPressureValues),
  systemBytes: nonnegativeNumber,
  hostBytes: nonnegativeNumber,
  trackedBytes: nonnegativeNumber,
  detachedBytes: nonnegativeNumber,
  detachedCount: nonnegativeInteger,
  categoryBytes: categoryBytesSchema,
  groups: Schema.mutable(Schema.Array(workspaceGroupSchema)).check(Schema.isMaxLength(200)),
  nodeProcesses: Schema.optionalKey(nodeProcessSummarySchema),
}))
export type MemorySnapshot = Mutable<Schema.Schema.Type<typeof memorySnapshotSchema>>

export const pressureSnapshotSchema = publicSchema(exactStruct({
  takenAt: Schema.Finite,
  supported: Schema.Boolean,
  pressure: Schema.Literals(memoryPressureValues),
  systemBytes: nonnegativeNumber,
}))
export type PressureSnapshot = Mutable<Schema.Schema.Type<typeof pressureSnapshotSchema>>

export const stopTargetSchema = exactStruct({
  pid: positiveInteger.annotate({ description: 'Root pid of a process tree from the snapshot.' }),
  startedAt: nonnegativeInteger.annotate({
    description: 'The tree’s startedAt from the snapshot; a recycled pid with another start time is refused.',
  }),
})
export type StopTarget = Mutable<Schema.Schema.Type<typeof stopTargetSchema>>

export const stopResultSchema = publicSchema(exactStruct({
  stopped: nonnegativeInteger,
  viaJob: nonnegativeInteger,
  missing: nonnegativeInteger,
  refused: nonnegativeInteger,
}))
export type StopResult = Mutable<Schema.Schema.Type<typeof stopResultSchema>>
