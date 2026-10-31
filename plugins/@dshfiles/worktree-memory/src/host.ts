import { readFile, readlink } from 'node:fs/promises'
import { homedir, totalmem, userInfo } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type { JobEvent, JobView } from '@deepseek-ai/dsh-jobs'
import { JobId } from '@deepseek-ai/dsh-jobs/brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-workspace'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { Subprocess } from '@dshfiles/dshx/effect/services'
import { defineHost } from '@dshfiles/dshx/host'
import { Clock, Context as EffectContext, Duration, Effect, Layer, Queue, Schema, type Scope } from 'effect'
import { worktreeMemoryApi } from './api.js'
import { nodeProcessCwdPids, summarizeNodeProcesses } from './node-process-summary.js'
import { ProcessTable, type KnownSession, type ProcessRow } from './process-table.js'
import { createSessionMetadataCache, type SessionMetadataCache } from './session-metadata-cache.js'
import { emptyCategoryBytes, type MemoryPressure, type MemorySnapshot, type ProcessTree, type StopResult, type StopTarget } from './types.js'

const SNAPSHOT_TTL_MS = 3_000
const PROBE_TIMEOUT_MS = 10_000
const SESSIONS_TIMEOUT_MS = 2_500
const KILL_GRACE_MS = 3_000
const MAX_PS_BYTES = 8 * 1024 * 1024
const MAX_CWD_PROBES = 400
const MAX_NODE_CWD_PROBES = 100
const STOP_REASON = 'stopped from the worktree memory panel'

interface JobRegistry {
  readonly events: { subscribe(filter: { readonly owners: 'all' }, listener: (event: JobEvent) => void): () => void }
  kill(id: JobId, caller?: SessionId, reason?: string): 'requested' | 'already-finished'
}

interface Probe {
  readonly snapshot: MemorySnapshot
  readonly rows: readonly ProcessRow[]
}

const rootServices = (context: Context) => ({ context })

type RootServices = ReturnType<typeof rootServices>

interface MemoryRuntime extends RootServices {
  readonly jobs: Map<string, JobView>
  readonly sessionMetadata: SessionMetadataCache
  readonly escalations: Queue.Queue<readonly ProcessRow[]>
  registry: JobRegistry | null
  cached: {
    readonly at: number
    readonly probe: Effect.Effect<Probe, WorktreeMemoryOperationError, Subprocess>
  } | null
}

class WorktreeMemory extends EffectContext.Service<WorktreeMemory, MemoryRuntime>()('dshfiles/worktree-memory/Runtime') {}

class WorktreeMemoryOperationError extends Schema.TaggedError<WorktreeMemoryOperationError>()('WorktreeMemoryOperationError', {
  operation: Schema.String,
}) {}

const makeLayer = (context: Context): Layer.Layer<WorktreeMemory | Subprocess, never, never> =>
  Layer.merge(
    Layer.effect(
      WorktreeMemory,
      Effect.gen(function* () {
        const escalations = yield* Queue.unbounded<readonly ProcessRow[]>()
        return {
          ...rootServices(context),
          jobs: new Map<string, JobView>(),
          sessionMetadata: createSessionMetadataCache(),
          escalations,
          registry: null,
          cached: null,
        }
      }),
    ),
    Subprocess.layer(context.subprocess),
  )

const unsupported = (now: number): MemorySnapshot => ({
  takenAt: now,
  supported: false,
  pressure: 'unknown',
  systemBytes: totalmem(),
  hostBytes: 0,
  trackedBytes: 0,
  detachedBytes: 0,
  detachedCount: 0,
  categoryBytes: emptyCategoryBytes(),
  groups: [],
  nodeProcesses: { processCount: 0, rssBytes: 0, truncated: false, origins: [] },
})

const run = Effect.fn('worktree-memory subprocess')(({ command, args }: { readonly command: string; readonly args: readonly string[] }) =>
  Effect.withSpan(
    Effect.scoped(
      Effect.gen(function* () {
        const subprocess = yield* Subprocess
        const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS)
        const executable = yield* subprocess.resolveExecutable(command).pipe(
          Effect.mapError(() => new WorktreeMemoryOperationError({ operation: 'resolve-executable' })),
        )
        const handle = yield* subprocess.spawnScoped({
          argv: [executable, ...args],
          cwd: homedir(),
          env: { ...process.env, LC_ALL: 'C' },
          stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_PS_BYTES }, stderr: { maxBytes: 64 * 1024 } },
          graceMs: 500,
          signal,
        }).pipe(Effect.mapError(() => new WorktreeMemoryOperationError({ operation: 'process-spawn' })))
        yield* Effect.tryPromise({
          try: () => handle.done,
          catch: () => new WorktreeMemoryOperationError({ operation: 'process-probe' }),
        })
        return handle.collected.stdout?.readFrom(0)?.text ?? ''
      }),
    ),
    'worktree-memory probe',
    { attributes: { 'process.executable.name': command } },
  ),
)

const readProcessTable = Effect.fn('worktree-memory read process table')(() =>
  Effect.map(
    run({ command: 'ps', args: ['-ww', '-x', '-U', String(process.getuid?.() ?? 0), '-o', 'pid=,ppid=,rss=,lstart=,args='] }),
    output => ProcessTable.parsePs(output),
  ),
)

const readCwds = Effect.fn('worktree-memory read working directories')((pids: readonly number[]) =>
  Effect.gen(function* () {
    const cwds = new Map<number, string>()
    const probed = pids.slice(0, MAX_CWD_PROBES)
    if (probed.length === 0) return cwds
    if (process.platform === 'linux') {
      const results = yield* Effect.forEach(
        probed,
        pid =>
          Effect.tryPromise({ try: () => readlink(`/proc/${String(pid)}/cwd`), catch: error => error }).pipe(
            Effect.map(cwd => ({ pid, cwd })),
            Effect.catch(() => Effect.succeed(undefined)),
          ),
        { concurrency: 'unbounded' },
      )
      for (const result of results) if (result !== undefined) cwds.set(result.pid, result.cwd)
      return cwds
    }
    let current: number | undefined
    const output = yield* run({ command: 'lsof', args: ['-a', '-d', 'cwd', '-F', 'pn', '-p', probed.join(',')] })
    for (const line of output.split('\n')) {
      if (line.startsWith('p')) current = Number(line.slice(1))
      else if (line.startsWith('n') && current !== undefined) cwds.set(current, line.slice(1))
    }
    return cwds
  }),
)

const darwinPressureLevels = new Map<string, MemoryPressure>([
  ['1', 'normal'],
  ['2', 'warning'],
  ['4', 'critical'],
])

const readPressure = Effect.fn('worktree-memory read pressure')((): Effect.Effect<MemoryPressure, never, Subprocess> =>
  Effect.gen(function* () {
    if (process.platform === 'darwin') {
      const level = (yield* run({ command: 'sysctl', args: ['-n', 'kern.memorystatus_vm_pressure_level'] })).trim()
      return yield* Effect.succeed<MemoryPressure>(darwinPressureLevels.get(level) ?? 'unknown')
    }
    if (process.platform === 'linux') {
      const data = yield* Effect.tryPromise({ try: () => readFile('/proc/pressure/memory', 'utf8'), catch: error => error }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (data === undefined) return yield* Effect.succeed<MemoryPressure>('unknown')
      const average = Number(/some avg10=([\d.]+)/.exec(data)?.[1] ?? Number.NaN)
      if (Number.isNaN(average)) return yield* Effect.succeed<MemoryPressure>('unknown')
      return yield* Effect.succeed<MemoryPressure>(average >= 20 ? 'critical' : average >= 5 ? 'warning' : 'normal')
    }
    return yield* Effect.succeed<MemoryPressure>('unknown')
  }).pipe(Effect.catch(() => Effect.succeed<MemoryPressure>('unknown'))),
)

const listedTitleSchema = Schema.String.check(Schema.isMinLength(1))
const listedCreationSchema = Schema.Struct({ createdAt: Schema.optionalKey(Schema.Finite) })

const readSessions = (active: MemoryRuntime): Promise<readonly KnownSession[] | undefined> => {
  const controller = active.context.get('sessionController')
  if (controller === undefined) return Promise.resolve(undefined)
  return controller.list({}, AbortSignal.timeout(SESSIONS_TIMEOUT_MS)).then(
    listed =>
      listed.items.map(summary => {
        const rawSummary: unknown = summary
        const createdAt = Schema.is(listedCreationSchema)(rawSummary) ? rawSummary.createdAt : undefined
        const rawTitle: unknown = summary.projections?.values.title
        const title = Schema.is(listedTitleSchema)(rawTitle) ? rawTitle : undefined
        return {
          sessionId: summary.sessionId,
          cwd: summary.cwd ?? null,
          createdAt: createdAt ?? null,
          running: summary.running,
          updatedAt: summary.updatedAt ?? null,
          title: title ?? null,
        }
      }),
    () => undefined,
  )
}

const probe = Effect.fn('worktree-memory build snapshot')((active: MemoryRuntime, includeSessions: boolean) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    if (process.platform !== 'darwin' && process.platform !== 'linux') return { snapshot: unsupported(now), rows: [] }
    const sessions = includeSessions ? active.sessionMetadata.read(() => readSessions(active)) : []
    const [rows, pressure] = yield* Effect.all([readProcessTable(), readPressure()], { concurrency: 2 })
    const candidates = ProcessTable.candidates({ rows, hostPid: process.pid })
    const nodePids = nodeProcessCwdPids({ rows, limit: MAX_NODE_CWD_PROBES })
    const cwds = yield* readCwds([...new Set([...candidates.hostChildren, ...candidates.orphans, ...nodePids])])
    const workspaces = (active.context.get('workspaceRegistry')?.list() ?? []).map(workspace => ({
      path: workspace.path,
      title: workspace.title,
    }))
    const jobs = [...active.jobs.values()]
      .filter(job => job.status === 'running' || job.status === 'stopping')
      .map(job => ({ id: job.id, label: job.label, owner: job.owner ?? null, startedAt: job.startedAt }))
    const snapshot = ProcessTable.snapshot({
      rows,
      cwds,
      hostPid: process.pid,
      home: userInfo().homedir,
      now,
      workspaces,
      sessions,
      jobs,
      pressure,
      systemBytes: totalmem(),
    })
    return { snapshot: { ...snapshot, nodeProcesses: summarizeNodeProcesses({ rows, cwds, home: userInfo().homedir }) }, rows }
  }),
)

const currentProbe = (active: MemoryRuntime, fresh: boolean, includeSessions = true) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    if (!fresh && active.cached !== null && now - active.cached.at < SNAPSHOT_TTL_MS) return yield* active.cached.probe
    const cached = yield* Effect.cached(probe(active, includeSessions))
    active.cached = { at: now, probe: cached }
    return yield* cached.pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          if (active.cached?.probe === cached) active.cached = null
        }),
      ),
    )
  })

const signal = (pid: number, name: NodeJS.Signals): boolean => {
  try {
    process.kill(pid, name)
    return true
  } catch {
    return false
  }
}

const escalate = Effect.fn('worktree-memory escalate stop')((active: MemoryRuntime, signalled: readonly ProcessRow[]) =>
  Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(KILL_GRACE_MS))
    const current = yield* readProcessTable()
    const alive = new Map(current.map(row => [row.pid, row.startedAt]))
    yield* Effect.sync(() => {
      for (const row of signalled) if (alive.get(row.pid) === row.startedAt) signal(row.pid, 'SIGKILL')
    })
  }).pipe(
    Effect.catch(() =>
      Effect.sync(() => active.context.logger.warn('worktree-memory: SIGKILL escalation skipped after a process-table read failure')),
    ),
  ),
)

const escalationLoop = (active: MemoryRuntime) =>
  Effect.forever(
    Effect.gen(function* () {
      const signalled = yield* Queue.take(active.escalations)
      yield* escalate(active, signalled).pipe(Effect.forkScoped)
    }),
  )

const stop = Effect.fn('worktree-memory stop processes')((active: MemoryRuntime, targets: readonly StopTarget[]) =>
  Effect.gen(function* () {
    const { snapshot, rows } = yield* currentProbe(active, true, false)
    const trees = new Map<number, ProcessTree>(snapshot.groups.flatMap(group => group.trees.map(tree => [tree.pid, tree] as const)))
    const byPid = new Map(rows.map(row => [row.pid, row]))
    const result: StopResult = { stopped: 0, viaJob: 0, missing: 0, refused: 0 }
    const signalled: ProcessRow[] = []
    yield* Effect.sync(() => {
      for (const target of targets) {
        const tree = trees.get(target.pid)
        if (tree === undefined) {
          if (byPid.has(target.pid)) result.refused++
          else result.missing++
          continue
        }
        if (tree.startedAt !== target.startedAt) {
          result.refused++
          continue
        }
        if (tree.jobId !== null && active.registry !== null) {
          active.registry.kill(JobId(tree.jobId), tree.sessionId === null ? undefined : SessionId(tree.sessionId), STOP_REASON)
          result.viaJob++
          continue
        }
        for (const pid of ProcessTable.treePids(rows, tree.pid)) {
          if (pid === process.pid) continue
          const row = byPid.get(pid)
          if (row !== undefined && signal(pid, 'SIGTERM')) signalled.push(row)
        }
        result.stopped++
      }
      active.cached = null
    })
    if (signalled.length > 0) yield* Queue.offer(active.escalations, signalled)
    return result
  }),
)

const applyJobEvent = (jobs: Map<string, JobView>, event: JobEvent): void => {
  if (event.type === 'removed') jobs.delete(event.job.id)
  else if (event.type !== 'output') jobs.set(event.job.id, event.job)
}

const { hostApi, ...plugin } = DshxEffect.plugin({
  layer: makeLayer,
  setup: (context: Context): Effect.Effect<void, never, WorktreeMemory | Subprocess | Scope.Scope> =>
    Effect.gen(function* () {
      const active = yield* WorktreeMemory
      yield* Effect.sync(() => {
        context.inject(['jobs'], scoped => {
          const registry = scoped.get('jobs')
          if (registry === undefined) return
          scoped.effect(() => {
            active.registry = registry
            const unsubscribe = registry.events.subscribe({ owners: 'all' }, event => applyJobEvent(active.jobs, event))
            return () => {
              unsubscribe()
              active.registry = null
              active.jobs.clear()
            }
          }, 'worktree-memory: live job tracking')
        })
      })
      yield* escalationLoop(active).pipe(Effect.forkScoped)
    }),
})

const api = hostApi(worktreeMemoryApi, {
  snapshot: Effect.fn('worktree-memory snapshot')(() =>
    Effect.gen(function* () {
      const active = yield* WorktreeMemory
      return (yield* currentProbe(active, false)).snapshot
    }),
  ),
  pressure: Effect.fn('worktree-memory pressure')(() =>
    Effect.gen(function* () {
      const supported = process.platform === 'darwin' || process.platform === 'linux'
      const pressure: MemoryPressure = supported ? yield* readPressure() : 'unknown'
      return {
        takenAt: yield* Clock.currentTimeMillis,
        supported,
        pressure,
        systemBytes: totalmem(),
      }
    }),
  ),
  stop: Effect.fn('worktree-memory stop')(({ input }) =>
    Effect.gen(function* () {
      const active = yield* WorktreeMemory
      return yield* stop(active, input.targets)
    }),
  ),
})

export default defineHost({
  ...plugin,
  name: '@dshfiles/worktree-memory',
  inject: ['subprocess'],
  apis: [api],
})
