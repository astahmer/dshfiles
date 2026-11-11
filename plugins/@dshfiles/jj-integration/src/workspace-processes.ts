import { Context, Duration, Effect, FileSystem, Layer, Path } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { MAX_PROCESS_COMMAND_LENGTH, MAX_WORKSPACE_PROCESSES, type WorkspaceProcessView } from './api.js'

/** One process of the Host's user, as the platform's process table reports it. */
export interface ProcessEntry {
  readonly pid: number
  readonly ppid: number
  readonly cwd: string
  readonly command: string
  /** A controlling terminal: someone's interactive shell or a command typed into one, never stopped for them. */
  readonly terminal: boolean
}

type WorkspaceProcess = WorkspaceProcessView
type WorkspaceProcessOutcome = WorkspaceProcess['outcome']

const DEFAULT_GRACE = Duration.seconds(5)
const POLL_INTERVAL = Duration.millis(100)

const commandName = (command: string): string => {
  const trimmed = command.trim()
  const name = trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed
  return name.slice(0, MAX_PROCESS_COMMAND_LENGTH)
}

/** Pure decisions over a process table snapshot: which entries a workspace removal may stop. */
export class WorkspaceProcessModel {
  /** `cwd` is the workspace folder or inside it; a sibling sharing the prefix (`thread-1` vs `thread-10`) is not. */
  static readonly isInside = (input: { readonly cwd: string; readonly workspacePath: string; readonly separator: string }): boolean => {
    const root = input.workspacePath.endsWith(input.separator) ? input.workspacePath.slice(0, -input.separator.length) : input.workspacePath
    return input.cwd === root || input.cwd.startsWith(`${root}${input.separator}`)
  }

  /** The Host and every process it runs under: stopping one of them would stop DSH itself. */
  static readonly protectedPids = (input: { readonly table: readonly ProcessEntry[]; readonly hostPid: number }): ReadonlySet<number> => {
    const parents = new Map(input.table.map(entry => [entry.pid, entry.ppid]))
    const protectedPids = new Set<number>([input.hostPid])
    let current = parents.get(input.hostPid)
    while (current !== undefined && current > 1 && !protectedPids.has(current)) {
      protectedPids.add(current)
      current = parents.get(current)
    }
    return protectedPids
  }

  /**
   * Processes still running inside `workspacePath`. The table already holds only the Host user's processes. Nothing is
   * selected when the Host's own folder is inside the workspace, or when the path is not an absolute folder below `/`.
   */
  static readonly inside = (input: {
    readonly table: readonly ProcessEntry[]
    readonly workspacePath: string
    readonly hostPid: number
    readonly hostCwd: string
    readonly separator: string
  }): readonly ProcessEntry[] => {
    const absolute = input.workspacePath.startsWith(input.separator) || /^[A-Za-z]:[\\/]/.test(input.workspacePath)
    const trimmed = input.workspacePath.replace(/[\\/]+$/, '')
    if (!absolute || trimmed.length === 0 || /^[A-Za-z]:$/.test(trimmed)) return []
    const within = (cwd: string) => WorkspaceProcessModel.isInside({ cwd, workspacePath: input.workspacePath, separator: input.separator })
    if (within(input.hostCwd)) return []
    const protectedPids = WorkspaceProcessModel.protectedPids(input)
    return input.table.filter(entry => entry.pid > 1 && !protectedPids.has(entry.pid) && within(entry.cwd))
  }

  /** The preview's rows: what a removal would stop, and the terminals it leaves alone. */
  static readonly preview = (entries: readonly ProcessEntry[]): readonly WorkspaceProcess[] =>
    entries
      .slice(0, MAX_WORKSPACE_PROCESSES)
      .map(entry => ({ pid: entry.pid, command: commandName(entry.command), outcome: entry.terminal ? 'kept-terminal' : 'would-stop' }))

  /** macOS `ps -o pid=,ppid=,tty=,comm=` plus `lsof -Fpn -d cwd`, joined by pid; a pid without a cwd line is skipped. */
  static readonly parseDarwin = (input: { readonly ps: string; readonly lsof: string }): readonly ProcessEntry[] => {
    const cwdByPid = new Map<number, string>()
    let pid: number | undefined
    for (const line of input.lsof.split('\n')) {
      if (line.startsWith('p')) pid = Number(line.slice(1))
      else if (line.startsWith('n') && pid !== undefined && Number.isInteger(pid)) cwdByPid.set(pid, line.slice(1))
    }
    const entries: ProcessEntry[] = []
    for (const line of input.ps.split('\n')) {
      const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
      if (match === null) continue
      const entryPid = Number(match[1])
      const cwd = cwdByPid.get(entryPid)
      if (cwd === undefined) continue
      const tty = match[3] ?? '??'
      entries.push({ pid: entryPid, ppid: Number(match[2]), cwd, command: match[4] ?? '', terminal: tty !== '??' && tty !== '-' })
    }
    return entries
  }
}

export interface WorkspaceProcessesShape {
  /** Dry run over one process table read: per workspace, what its removal would stop and the terminals it would keep. */
  readonly inspect: (workspacePaths: readonly string[]) => Effect.Effect<ReadonlyMap<string, readonly WorkspaceProcess[]>>
  /** SIGTERM every selected process, SIGKILL whichever is still inside the workspace after the grace period. */
  readonly stop: (input: { readonly workspacePath: string; readonly grace?: Duration.Input | undefined }) => Effect.Effect<readonly WorkspaceProcess[]>
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the pid exists under another user: a recycled pid, which is never ours to signal.
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

const signal = (pid: number, name: NodeJS.Signals): boolean => {
  try {
    process.kill(pid, name)
    return true
  } catch {
    return false
  }
}

const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const uid = process.getuid?.()

  const darwinTable = Effect.gen(function* () {
    if (uid === undefined) return []
    const user = String(uid)
    const [ps, lsof] = yield* Effect.all(
      [
        spawner.string(ChildProcess.make('ps', ['-U', user, '-o', 'pid=,ppid=,tty=,comm='], { stdin: 'ignore' })),
        spawner.string(ChildProcess.make('lsof', ['-w', '-a', '-d', 'cwd', '-u', user, '-Fpn'], { stdin: 'ignore' })),
      ],
      { concurrency: 2 },
    )
    return WorkspaceProcessModel.parseDarwin({ ps, lsof })
  })

  const linuxEntry = Effect.fnUntraced(function* (pid: number) {
    const status = yield* fileSystem.readFileString(`/proc/${String(pid)}/status`)
    const owner = /^Uid:\s+(\d+)/m.exec(status)?.[1]
    if (owner === undefined || Number(owner) !== uid) return undefined
    const ppid = Number(/^PPid:\s+(\d+)/m.exec(status)?.[1] ?? 0)
    const stat = yield* fileSystem.readFileString(`/proc/${String(pid)}/stat`)
    const ttyNumber = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[4] ?? 0)
    const cwd = yield* fileSystem.readLink(`/proc/${String(pid)}/cwd`)
    const command = (yield* fileSystem.readFileString(`/proc/${String(pid)}/comm`)).trim()
    return { pid, ppid, cwd, command, terminal: ttyNumber !== 0 } satisfies ProcessEntry
  })

  const linuxTable = Effect.gen(function* () {
    if (uid === undefined) return []
    const pids = (yield* fileSystem.readDirectory('/proc')).filter(name => /^\d+$/.test(name)).map(Number)
    // A process that exits mid-read, or belongs to someone else, is simply not listed.
    const entries = yield* Effect.forEach(pids, pid => linuxEntry(pid).pipe(Effect.orElseSucceed(() => undefined)), { concurrency: 16 })
    return entries.filter(entry => entry !== undefined)
  })

  /** An unreadable table selects nothing: a removal never stops a process it could not place inside the workspace. */
  const none: readonly ProcessEntry[] = []
  const table = Effect.gen(function* () {
    if (process.platform === 'darwin') return yield* darwinTable
    if (process.platform === 'linux') return yield* linuxTable
    return []
  }).pipe(Effect.catch(error => Effect.as(Effect.logWarning(`jj-integration: could not list processes: ${error.message}`), none)))

  const resolvedPath = (candidate: string) => fileSystem.realPath(candidate).pipe(Effect.orElseSucceed(() => candidate))

  const insideOf = Effect.fnUntraced(function* (snapshot: readonly ProcessEntry[], workspacePath: string) {
    const [resolvedWorkspace, hostCwd] = yield* Effect.all([resolvedPath(workspacePath), resolvedPath(process.cwd())])
    return WorkspaceProcessModel.inside({ table: snapshot, workspacePath: resolvedWorkspace, hostPid: process.pid, hostCwd, separator: path.sep })
  })

  const inside = (workspacePath: string) => Effect.flatMap(table, snapshot => insideOf(snapshot, workspacePath))

  const inspect = Effect.fn('jj-integration workspace processes inspect')(function* (workspacePaths: readonly string[]) {
    const found = new Map<string, readonly WorkspaceProcess[]>()
    if (workspacePaths.length === 0) return found
    const snapshot = yield* table
    yield* Effect.forEach(
      workspacePaths,
      workspacePath => Effect.map(insideOf(snapshot, workspacePath), entries => found.set(workspacePath, WorkspaceProcessModel.preview(entries))),
      { discard: true },
    )
    yield* Effect.annotateCurrentSpan({ 'dshx.processes.found': [...found.values()].reduce((total, entries) => total + entries.length, 0) })
    return found
  })

  const waitForExit = Effect.fnUntraced(function* (pids: readonly number[], grace: Duration.Input) {
    const deadline = Date.now() + Duration.toMillis(Duration.fromInputUnsafe(grace))
    let alive = pids.filter(isAlive)
    while (alive.length > 0 && Date.now() < deadline) {
      yield* Effect.sleep(POLL_INTERVAL)
      alive = alive.filter(isAlive)
    }
    return new Set(alive)
  })

  const stop = Effect.fn('jj-integration workspace processes stop')(function* (input: {
    readonly workspacePath: string
    readonly grace?: Duration.Input | undefined
  }) {
    const found = yield* inside(input.workspacePath)
    const targets = found.filter(entry => !entry.terminal).slice(0, MAX_WORKSPACE_PROCESSES)
    const kept = found.filter(entry => entry.terminal)
    const signalled = targets.filter(entry => signal(entry.pid, 'SIGTERM'))
    const survivors = yield* waitForExit(
      signalled.map(entry => entry.pid),
      input.grace ?? DEFAULT_GRACE,
    )
    // Re-read before SIGKILL: a pid recycled during the grace period is no longer inside the workspace.
    const stillInside = survivors.size === 0 ? new Set<number>() : new Set((yield* inside(input.workspacePath)).map(entry => entry.pid))
    const killed = new Set([...survivors].filter(pid => stillInside.has(pid) && signal(pid, 'SIGKILL')))
    const remaining = killed.size === 0 ? new Set<number>() : yield* waitForExit([...killed], Duration.seconds(1))
    const outcome = (pid: number): WorkspaceProcessOutcome => {
      if (!signalled.some(entry => entry.pid === pid) || remaining.has(pid)) return 'failed'
      if (killed.has(pid)) return 'killed'
      return survivors.has(pid) && stillInside.has(pid) ? 'failed' : 'stopped'
    }
    const report: WorkspaceProcess[] = [
      ...targets.map(entry => ({ pid: entry.pid, command: commandName(entry.command), outcome: outcome(entry.pid) })),
      ...kept.map(entry => ({ pid: entry.pid, command: commandName(entry.command), outcome: 'kept-terminal' as const })),
    ].slice(0, MAX_WORKSPACE_PROCESSES)
    yield* Effect.annotateCurrentSpan({
      'dshx.processes.found': found.length,
      'dshx.processes.stopped': report.filter(entry => entry.outcome === 'stopped').length,
      'dshx.processes.killed': killed.size,
      'dshx.processes.failed': report.filter(entry => entry.outcome === 'failed').length,
    })
    return report
  })

  return { inspect, stop } satisfies WorkspaceProcessesShape
})

/**
 * Finds and stops the Host user's processes whose working directory is inside a thread workspace, before cleanup
 * removes it. Only processes without a controlling terminal are stopped (what an agent started in the background);
 * an interactive shell is reported and kept. The Host and its ancestors are never selected.
 */
export class WorkspaceProcesses extends Context.Service<WorkspaceProcesses, WorkspaceProcessesShape>()('@dshfiles/jj-integration/WorkspaceProcesses') {
  static readonly layer = Layer.effect(WorkspaceProcesses, make)
}
