import { z } from 'zod'

export const processCategoryValues = ['dev-server', 'tests', 'build', 'dsh', 'services', 'other'] as const
export type ProcessCategory = (typeof processCategoryValues)[number]

export const emptyCategoryBytes = () => ({ 'dev-server': 0, tests: 0, build: 0, dsh: 0, services: 0, other: 0 }) satisfies Record<ProcessCategory, number>

export const memoryPressureValues = ['normal', 'warning', 'critical', 'unknown'] as const
export type MemoryPressure = (typeof memoryPressureValues)[number]

/**
 * - `job`: a live background job of this Host, matched to its process tree.
 * - `host`: a child of this Host no live job claims (terminal shells, tool helpers).
 * - `detached`: a process tree re-parented to init that still runs inside a workspace: a daemon a command started on
 *   purpose (`dshx dev up`), or one an earlier DSH process or a finished command left behind.
 */
export const processOriginValues = ['job', 'host', 'detached'] as const
export type ProcessOrigin = (typeof processOriginValues)[number]

export const processTreeSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.number().int().nonnegative(),
  name: z.string().max(120),
  command: z.string().max(400),
  cwd: z.string().max(1024),
  bytes: z.number().nonnegative(),
  processCount: z.number().int().positive(),
  origin: z.enum(processOriginValues),
  category: z.enum(processCategoryValues),
  jobId: z.string().max(128).nullable(),
  sessionId: z.string().max(128).nullable(),
  ownerRunning: z.boolean().default(false).describe('A live job whose owning Session is mid-turn; a bulk stop leaves it to that thread’s own Stop.'),
})
export type ProcessTree = z.infer<typeof processTreeSchema>

export const workspaceThreadSchema = z.object({
  sessionId: z.string().max(128),
  title: z.string().max(300).nullable(),
  running: z.boolean(),
  updatedAt: z.number().nullable(),
})
export type WorkspaceThread = z.infer<typeof workspaceThreadSchema>

/** `project` is a registered workspace; `workspace` a thread or jj sibling checkout of one; `elsewhere` collects Host children outside every workspace. */
export const workspaceGroupKindValues = ['project', 'workspace', 'elsewhere'] as const

export const workspaceGroupSchema = z.object({
  key: z.string().max(1024),
  title: z.string().max(300),
  path: z.string().max(1024),
  kind: z.enum(workspaceGroupKindValues),
  project: z.string().max(300).nullable(),
  bytes: z.number().nonnegative(),
  detachedBytes: z.number().nonnegative(),
  detachedCount: z.number().int().nonnegative(),
  threadCount: z.number().int().nonnegative(),
  threads: z.array(workspaceThreadSchema).max(20),
  trees: z.array(processTreeSchema).max(200),
})
export type WorkspaceGroup = z.infer<typeof workspaceGroupSchema>

export const memorySnapshotSchema = z.object({
  takenAt: z.number(),
  supported: z.boolean(),
  pressure: z.enum(memoryPressureValues),
  systemBytes: z.number().nonnegative(),
  hostBytes: z.number().nonnegative(),
  trackedBytes: z.number().nonnegative(),
  detachedBytes: z.number().nonnegative(),
  detachedCount: z.number().int().nonnegative(),
  categoryBytes: z.record(z.enum(processCategoryValues), z.number().nonnegative()),
  groups: z.array(workspaceGroupSchema).max(200),
})
export type MemorySnapshot = z.infer<typeof memorySnapshotSchema>

export const stopTargetSchema = z
  .object({
    pid: z.number().int().positive().describe('Root pid of a process tree from the snapshot.'),
    startedAt: z.number().int().nonnegative().describe('The tree’s startedAt from the snapshot; a recycled pid with another start time is refused.'),
  })
  .strict()
export type StopTarget = z.infer<typeof stopTargetSchema>

export const stopResultSchema = z.object({
  stopped: z.number().int().nonnegative(),
  viaJob: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  refused: z.number().int().nonnegative(),
})
export type StopResult = z.infer<typeof stopResultSchema>
