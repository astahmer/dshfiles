import { homedir, totalmem, userInfo } from 'node:os'
import { Clock, Context, Duration, Effect, FiberSet, FileSystem, Layer, Schema, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { HostDirectory, JobTracker } from './host-edge-promise.js'
import { nodeProcessCwdPids, summarizeNodeProcesses } from './node-process-summary.js'
import { ProcessTable, type ProcessRow } from './process-table.js'
import { SessionMetadata } from './session-metadata-cache.js'
import { emptyCategoryBytes, type MemoryPressure, type MemorySnapshot, type ProcessTree, type StopResult, type StopTarget } from './types.js'

const SNAPSHOT_TTL = Duration.seconds(3)
const PROBE_TIMEOUT = Duration.seconds(10)
const KILL_GRACE = Duration.seconds(3)
const MAX_PS_CHARACTERS = 8 * 1024 * 1024
const MAX_CWD_PROBES = 400
const MAX_NODE_CWD_PROBES = 100

/** A process probe (`ps`, `lsof`, `sysctl`) could not run or did not finish in time. */
export class ProbeFailed extends Schema.TaggedError<ProbeFailed>()(
  'ProbeFailed',
  { command: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'worktree-memory-probe-failed' },
) {
  override get message(): string {
    return `Reading process memory failed: ${this.command} did not run. Retry; if it keeps failing, check that ${this.command} is installed and on PATH.`
  }
}

const supportedPlatform = process.platform === 'darwin' || process.platform === 'linux'

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

// kern.memorystatus_vm_pressure_level reports 1 (normal), 2 (warning) or 4 (critical).
const darwinPressureLevels = new Map<string, MemoryPressure>([
  ['1', 'normal'],
  ['2', 'warning'],
  ['4', 'critical'],
])

const linuxPressure = (text: string): MemoryPressure => {
  const average = Number(/some avg10=([\d.]+)/.exec(text)?.[1] ?? Number.NaN)
  if (Number.isNaN(average)) return 'unknown'
  return average >= 20 ? 'critical' : average >= 5 ? 'warning' : 'normal'
}

interface Probe {
  readonly snapshot: MemorySnapshot
  readonly rows: readonly ProcessRow[]
}

/** Resident memory of this user's processes, grouped by the DSH workspace, Session or job that owns them. */
export class ProcessProbe extends Context.Service<
  ProcessProbe,
  {
    /** One probe serves every caller within the TTL, so a polling panel in several tabs costs one `ps`; `fresh` skips it. */
    readonly snapshot: (input: { readonly fresh: boolean }) => Effect.Effect<MemorySnapshot, ProbeFailed>
    /** An uncached probe without Session metadata, for a stop that must see the current process identities. */
    readonly probeForStop: Effect.Effect<Probe, ProbeFailed>
    readonly processTable: Effect.Effect<ProcessRow[], ProbeFailed>
    readonly pressure: Effect.Effect<MemoryPressure>
  }
>()('@dshfiles/worktree-memory/ProcessProbe') {
  static readonly layer = Layer.effect(
    ProcessProbe,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const fs = yield* FileSystem.FileSystem
      const directory = yield* HostDirectory
      const jobs = yield* JobTracker
      const sessionMetadata = yield* SessionMetadata

      const run = Effect.fn('worktree-memory probe')(
        function* (command: string, args: readonly string[]) {
          yield* Effect.annotateCurrentSpan({ 'process.executable.name': command })
          const handle = yield* spawner.spawn(ChildProcess.make(command, args, { cwd: homedir(), env: { LC_ALL: 'C' }, extendEnv: true, stderr: 'ignore' }))
          return yield* handle.stdout.pipe(
            Stream.decodeText(),
            Stream.runFold(
              () => '',
              (text, chunk) => (text.length >= MAX_PS_CHARACTERS ? text : text + chunk),
            ),
          )
        },
        Effect.scoped,
        Effect.timeout(PROBE_TIMEOUT),
        (effect, command) => Effect.mapError(effect, cause => new ProbeFailed({ command, cause })),
      )

      const processTable = run('ps', ['-ww', '-x', '-U', String(process.getuid?.() ?? 0), '-o', 'pid=,ppid=,rss=,lstart=,args=']).pipe(
        Effect.map(ProcessTable.parsePs),
      )

      const readCwds = Effect.fn('worktree-memory read cwds')(function* (pids: readonly number[]) {
        const probed = pids.slice(0, MAX_CWD_PROBES)
        if (probed.length === 0) return new Map<number, string>()
        if (process.platform === 'linux') {
          const linked = yield* Effect.forEach(
            probed,
            pid =>
              fs.readLink(`/proc/${String(pid)}/cwd`).pipe(
                Effect.map(cwd => [pid, cwd] as const),
                Effect.option,
              ),
            { concurrency: 8 },
          )
          return new Map(linked.flatMap(entry => (entry._tag === 'Some' ? [entry.value] : [])))
        }
        // `lsof -F pn` prints `p<pid>` then `n<path>` per process; a pid that exited in between is simply absent.
        const cwds = new Map<number, string>()
        let current: number | undefined
        for (const line of (yield* run('lsof', ['-a', '-d', 'cwd', '-F', 'pn', '-p', probed.join(',')])).split('\n')) {
          if (line.startsWith('p')) current = Number(line.slice(1))
          else if (line.startsWith('n') && current !== undefined) cwds.set(current, line.slice(1))
        }
        return cwds
      })

      const pressure: Effect.Effect<MemoryPressure> = Effect.gen(function* () {
        if (process.platform === 'darwin') {
          const level = (yield* run('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'])).trim()
          return darwinPressureLevels.get(level) ?? 'unknown'
        }
        if (process.platform === 'linux') return linuxPressure(yield* fs.readFileString('/proc/pressure/memory'))
        return 'unknown'
      }).pipe(Effect.orElseSucceed((): MemoryPressure => 'unknown'))

      const probe = Effect.fn('worktree-memory snapshot probe')(function* (includeSessions: boolean) {
        const now = yield* Clock.currentTimeMillis
        if (!supportedPlatform) return { snapshot: unsupported(now), rows: [] }
        const sessions = includeSessions ? yield* sessionMetadata.current : []
        const [rows, currentPressure] = yield* Effect.all([processTable, pressure], { concurrency: 'unbounded' })
        const candidates = ProcessTable.candidates({ rows, hostPid: process.pid })
        const nodePids = nodeProcessCwdPids({ rows, limit: MAX_NODE_CWD_PROBES })
        const cwds = yield* readCwds([...new Set([...candidates.hostChildren, ...candidates.orphans, ...nodePids])])
        const home = userInfo().homedir
        const snapshot = ProcessTable.snapshot({
          rows,
          cwds,
          hostPid: process.pid,
          home,
          now,
          workspaces: yield* directory.workspaces,
          sessions,
          jobs: yield* jobs.running,
          pressure: currentPressure,
          systemBytes: totalmem(),
        })
        const probed: Probe = { snapshot: { ...snapshot, nodeProcesses: summarizeNodeProcesses({ rows, cwds, home }) }, rows }
        return probed
      })

      const [cachedProbe, invalidate] = yield* Effect.cachedInvalidateWithTTL(probe(true), exit => (exit._tag === 'Success' ? SNAPSHOT_TTL : Duration.zero))

      const snapshot = Effect.fn('worktree-memory snapshot')(function* (input: { readonly fresh: boolean }) {
        if (input.fresh) yield* invalidate
        return (yield* cachedProbe).snapshot
      })

      return ProcessProbe.of({ snapshot, probeForStop: Effect.andThen(probe(false), result => Effect.as(invalidate, result)), processTable, pressure })
    }),
  )
}

const sendSignal = (pid: number, name: NodeJS.Signals) =>
  Effect.try(() => process.kill(pid, name)).pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }))

/** Stops process trees a snapshot listed: a live job through its registry, any other tree with SIGTERM then SIGKILL. */
export class ProcessStopper extends Context.Service<
  ProcessStopper,
  { readonly stop: (targets: readonly StopTarget[]) => Effect.Effect<StopResult, ProbeFailed> }
>()('@dshfiles/worktree-memory/ProcessStopper') {
  static readonly layer = Layer.effect(
    ProcessStopper,
    Effect.gen(function* () {
      const probe = yield* ProcessProbe
      const jobs = yield* JobTracker
      const escalations = yield* FiberSet.make()

      /** Escalate only on the exact identities signalled: a pid recycled during the grace period is left alone. */
      const escalate = (signalled: readonly ProcessRow[]) =>
        Effect.gen(function* () {
          yield* Effect.sleep(KILL_GRACE)
          const alive = new Map((yield* probe.processTable).map(row => [row.pid, row.startedAt]))
          yield* Effect.forEach(signalled, row => (alive.get(row.pid) === row.startedAt ? sendSignal(row.pid, 'SIGKILL') : Effect.void), { discard: true })
        }).pipe(
          Effect.catchTag('ProbeFailed', error => Effect.logWarning('worktree-memory: SIGKILL escalation skipped', error)),
          Effect.withSpan('worktree-memory stop escalate'),
        )

      const stop = Effect.fn('worktree-memory stop')(function* (targets: readonly StopTarget[]) {
        const { snapshot, rows } = yield* probe.probeForStop
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
          if (tree.jobId !== null && (yield* jobs.kill({ jobId: tree.jobId, sessionId: tree.sessionId }))) {
            result.viaJob++
            continue
          }
          for (const pid of ProcessTable.treePids(rows, tree.pid)) {
            if (pid === process.pid) continue
            const row = byPid.get(pid)
            if (row !== undefined && (yield* sendSignal(pid, 'SIGTERM'))) signalled.push(row)
          }
          result.stopped++
        }
        if (signalled.length > 0) yield* FiberSet.run(escalations, escalate(signalled))
        return result
      })

      return ProcessStopper.of({ stop })
    }),
  )
}
