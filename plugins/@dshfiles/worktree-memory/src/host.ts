import { readFile, readlink } from 'node:fs/promises'
import { homedir, totalmem, userInfo } from 'node:os'
import type { Context, Effect } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type { JobEvent, JobView } from '@deepseek-ai/dsh-jobs'
import { JobId } from '@deepseek-ai/dsh-jobs/brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-workspace'
import { defineHost } from '@dshfiles/dshx/host'
import { z } from 'zod'
import { worktreeMemoryApi } from './api.js'
import { nodeProcessCwdPids, summarizeNodeProcesses } from './node-process-summary.js'
import { ProcessTable, type KnownSession, type ProcessRow } from './process-table.js'
import { createSessionMetadataCache, type SessionMetadataCache } from './session-metadata-cache.js'
import { emptyCategoryBytes, type MemoryPressure, type MemorySnapshot, type ProcessTree, type StopResult, type StopTarget } from './types.js'
import { withSpan } from '@dshfiles/dshx/tracing'

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

interface MemoryRuntime {
  readonly context: Context
  readonly jobs: Map<string, JobView>
  readonly sessionMetadata: SessionMetadataCache
  registry: JobRegistry | null
  cached: { readonly at: number; readonly probe: Promise<Probe> } | null
}

let runtime: MemoryRuntime | undefined

const requireRuntime = (): MemoryRuntime => {
  if (runtime === undefined) throw new Error('Worktree memory Host is not active.')
  return runtime
}

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

const run = (context: Context, command: string, args: readonly string[]): Promise<string> =>
  withSpan('worktree-memory probe', { kind: 'client', attributes: { 'process.executable.name': command } }, () => runUntraced(context, command, args))

const runUntraced = async (context: Context, command: string, args: readonly string[]): Promise<string> => {
  const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS)
  const executable = await context.subprocess.resolveExecutable(command, undefined, signal)
  const handle = context.subprocess.spawn({
    argv: [executable, ...args],
    cwd: homedir(),
    env: { ...process.env, LC_ALL: 'C' },
    stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_PS_BYTES }, stderr: { maxBytes: 64 * 1024 } },
    graceMs: 500,
    signal,
  })
  await handle.done
  return handle.collected.stdout?.readFrom(0)?.text ?? ''
}

const readProcessTable = async (context: Context): Promise<ProcessRow[]> =>
  ProcessTable.parsePs(await run(context, 'ps', ['-ww', '-x', '-U', String(process.getuid?.() ?? 0), '-o', 'pid=,ppid=,rss=,lstart=,args=']))

const readCwds = async (context: Context, pids: readonly number[]): Promise<Map<number, string>> => {
  const cwds = new Map<number, string>()
  const probed = pids.slice(0, MAX_CWD_PROBES)
  if (probed.length === 0) return cwds
  if (process.platform === 'linux') {
    await Promise.all(
      probed.map(pid =>
        readlink(`/proc/${String(pid)}/cwd`).then(
          cwd => cwds.set(pid, cwd),
          () => undefined,
        ),
      ),
    )
    return cwds
  }
  // `lsof -F pn` prints `p<pid>` then `n<path>` per process; a pid that exited in between is simply absent.
  let current: number | undefined
  for (const line of (await run(context, 'lsof', ['-a', '-d', 'cwd', '-F', 'pn', '-p', probed.join(',')])).split('\n')) {
    if (line.startsWith('p')) current = Number(line.slice(1))
    else if (line.startsWith('n') && current !== undefined) cwds.set(current, line.slice(1))
  }
  return cwds
}

// kern.memorystatus_vm_pressure_level reports 1 (normal), 2 (warning) or 4 (critical).
const darwinPressureLevels = new Map<string, MemoryPressure>([
  ['1', 'normal'],
  ['2', 'warning'],
  ['4', 'critical'],
])

const readPressure = async (context: Context): Promise<MemoryPressure> => {
  try {
    if (process.platform === 'darwin') {
      const level = (await run(context, 'sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'])).trim()
      return darwinPressureLevels.get(level) ?? 'unknown'
    }
    if (process.platform === 'linux') {
      const average = Number(/some avg10=([\d.]+)/.exec(await readFile('/proc/pressure/memory', 'utf8'))?.[1] ?? Number.NaN)
      if (Number.isNaN(average)) return 'unknown'
      return average >= 20 ? 'critical' : average >= 5 ? 'warning' : 'normal'
    }
  } catch {
    return 'unknown'
  }
  return 'unknown'
}

const listedTitleSchema = z.string().min(1)
const listedCreationSchema = z.object({ createdAt: z.number().optional() })

const readSessions = async (context: Context): Promise<readonly KnownSession[] | undefined> => {
  const controller = context.get('sessionController')
  if (controller === undefined) return undefined
  const listed = await controller.list({}, AbortSignal.timeout(SESSIONS_TIMEOUT_MS)).catch(() => undefined)
  if (listed === undefined) return undefined
  return listed.items.map(summary => ({
    sessionId: summary.sessionId,
    cwd: summary.cwd ?? null,
    createdAt: listedCreationSchema.safeParse(summary).data?.createdAt ?? null,
    running: summary.running,
    updatedAt: summary.updatedAt ?? null,
    // The list serves each title from its cached projections; the per-Session title read decoded whole logs.
    title: listedTitleSchema.safeParse(summary.projections?.values.title).data ?? null,
  }))
}

const probe = async (active: MemoryRuntime, includeSessions: boolean): Promise<Probe> => {
  const now = Date.now()
  if (process.platform !== 'darwin' && process.platform !== 'linux') return { snapshot: unsupported(now), rows: [] }
  const context = active.context
  const sessions = includeSessions ? active.sessionMetadata.read(() => readSessions(context)) : []
  const [rows, pressure] = await Promise.all([readProcessTable(context), readPressure(context)])
  const candidates = ProcessTable.candidates({ rows, hostPid: process.pid })
  const nodePids = nodeProcessCwdPids({ rows, limit: MAX_NODE_CWD_PROBES })
  const cwds = await readCwds(context, [...new Set([...candidates.hostChildren, ...candidates.orphans, ...nodePids])])
  const registry = context.get('workspaceRegistry')
  const workspaces = (registry?.list() ?? []).map(workspace => ({ path: workspace.path, title: workspace.title }))
  const jobs = [...active.jobs.values()]
    .filter(job => job.status === 'running' || job.status === 'stopping')
    .map(job => ({ id: job.id, label: job.label, owner: job.owner ?? null, startedAt: job.startedAt }))
  const home = userInfo().homedir
  const snapshot = ProcessTable.snapshot({
    rows,
    cwds,
    hostPid: process.pid,
    home,
    now,
    workspaces,
    sessions,
    jobs,
    pressure,
    systemBytes: totalmem(),
  })
  return { snapshot: { ...snapshot, nodeProcesses: summarizeNodeProcesses({ rows, cwds, home }) }, rows }
}

/** One probe serves every caller within the TTL, so a polling panel in several tabs costs one `ps`. */
const currentProbe = (active: MemoryRuntime, fresh: boolean, includeSessions = true): Promise<Probe> => {
  const now = Date.now()
  if (!fresh && active.cached !== null && now - active.cached.at < SNAPSHOT_TTL_MS) return active.cached.probe
  const next = probe(active, includeSessions)
  active.cached = { at: now, probe: next }
  next.catch(() => {
    if (active.cached?.probe === next) active.cached = null
  })
  return next
}

const signal = (pid: number, name: NodeJS.Signals): boolean => {
  try {
    process.kill(pid, name)
    return true
  } catch {
    return false
  }
}

const stop = async (active: MemoryRuntime, targets: readonly StopTarget[]): Promise<StopResult> => {
  const { snapshot, rows } = await currentProbe(active, true, false)
  const trees = new Map<number, ProcessTree>(snapshot.groups.flatMap(group => group.trees.map(tree => [tree.pid, tree] as const)))
  const byPid = new Map(rows.map(row => [row.pid, row]))
  const result = { stopped: 0, viaJob: 0, missing: 0, refused: 0 }
  const signalled: ProcessRow[] = []
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
  if (signalled.length > 0) {
    // Escalate only on the exact identities signalled: a pid recycled during the grace period is left alone.
    const timer = setTimeout(() => {
      void readProcessTable(active.context)
        .then(current => {
          const alive = new Map(current.map(row => [row.pid, row.startedAt]))
          for (const row of signalled) if (alive.get(row.pid) === row.startedAt) signal(row.pid, 'SIGKILL')
        })
        .catch((error: unknown) =>
          active.context.logger.warn('worktree-memory: SIGKILL escalation skipped: %s', error instanceof Error ? error.message : String(error)),
        )
    }, KILL_GRACE_MS)
    timer.unref()
  }
  active.cached = null
  return result
}

const api = worktreeMemoryApi.host({
  snapshot: async () => (await currentProbe(requireRuntime(), false)).snapshot,
  pressure: async () => {
    const supported = process.platform === 'darwin' || process.platform === 'linux'
    return {
      takenAt: Date.now(),
      supported,
      pressure: supported ? await readPressure(requireRuntime().context) : 'unknown',
      systemBytes: totalmem(),
    }
  },
  stop: ({ input }) => stop(requireRuntime(), input.targets),
})

const applyJobEvent = (jobs: Map<string, JobView>, event: JobEvent): void => {
  if (event.type === 'removed') jobs.delete(event.job.id)
  else if (event.type !== 'output') jobs.set(event.job.id, event.job)
}

const setupHost = (context: Context): Effect<void> => {
  const active: MemoryRuntime = {
    context,
    jobs: new Map(),
    sessionMetadata: createSessionMetadataCache(),
    registry: null,
    cached: null,
  }
  runtime = active
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
  return {
    async *[Symbol.asyncIterator]() {
      yield () => {
        if (runtime === active) runtime = undefined
      }
    },
  }
}

export default defineHost({
  name: '@dshfiles/worktree-memory',
  inject: ['subprocess'],
  apis: [api],
  setup: setupHost,
})
