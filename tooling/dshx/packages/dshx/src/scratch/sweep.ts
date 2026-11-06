import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ScratchRegistry, type ScratchRecord } from './registry.js'
import { ScratchStateRuntime } from './state.js'

/** Only a process whose command line carries this marker is ever signalled; the live DSH runs another profile. */
const SCRATCH_PROFILE_MARKER = '--profile dshx-boot'
const GUARD_MARKER = 'parent-guard.'
const LEGACY_MIN_AGE_MS = 2 * 60 * 60_000

export interface ScratchProcess {
  readonly pid: number
  readonly ppid: number
  readonly pgid: number
  readonly ageMs: number
  readonly command: string
}

export interface SweepAction {
  readonly kind: 'stop-orphan' | 'stop-legacy' | 'drop-record' | 'skip'
  readonly target: string
  readonly reason: string
  readonly pid?: number
}

export interface SweepResult {
  readonly actions: readonly SweepAction[]
  /** Records whose owner still runs: the scratch Hosts in use right now. */
  readonly live: readonly ScratchRecord[]
  readonly leftRunning: readonly number[]
}

const elapsedPatterns: readonly { readonly pattern: RegExp; readonly factors: readonly number[] }[] = [
  { pattern: /^(\d+)-(\d+):(\d+):(\d+)$/, factors: [86_400_000, 3_600_000, 60_000, 1_000] },
  { pattern: /^(\d+):(\d+):(\d+)$/, factors: [3_600_000, 60_000, 1_000] },
  { pattern: /^(\d+):(\d+)$/, factors: [60_000, 1_000] },
]

const parseElapsed = (text: string): number | undefined => {
  for (const { pattern, factors } of elapsedPatterns) {
    const match = pattern.exec(text)
    if (match !== null) return match.slice(1).reduce((total, part, index) => total + Number(part) * (factors[index] ?? 0), 0)
  }
  return undefined
}

/** The process table; `-ww` keeps the `--profile dshx-boot` marker that sits past a long node path. */
export const listProcesses = (): readonly ScratchProcess[] => {
  const result = spawnSync('ps', ['-axww', '-o', 'pid=,ppid=,pgid=,etime=,command='], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return result.stdout.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (match === null) return []
    const ageMs = parseElapsed(match[4] ?? '')
    if (ageMs === undefined) return []
    return [{ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), ageMs, command: match[5] ?? '' }]
  })
}

const commandOf = (pid: number): string => spawnSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim()

const groupAlive = (target: number): boolean => {
  try {
    process.kill(target, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

const signal = (target: number, name: NodeJS.Signals): void => {
  try {
    process.kill(target, name)
  } catch {
    // Exited in between.
  }
}

/**
 * Stop a scratch process: its whole group when a scratch process leads it (the Host itself, or its parent guard) and it
 * is not ours, else the pid alone. The command line is read again right before the first signal, so a pid that changed
 * hands since the table was read is left alone. SIGKILL follows the grace: busy orphaned Hosts were seen ignoring
 * SIGTERM for minutes.
 */
const stopScratchProcess = async (process_: ScratchProcess, graceMs: number): Promise<boolean> => {
  if (!commandOf(process_.pid).includes(SCRATCH_PROFILE_MARKER)) return true
  const ownGroup = Number(spawnSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).stdout.trim())
  const scratchLedGroup = process_.pgid === process_.pid || commandOf(process_.pgid).includes(SCRATCH_PROFILE_MARKER)
  const target = process_.pgid > 1 && process_.pgid !== ownGroup && scratchLedGroup ? -process_.pgid : process_.pid
  signal(target, 'SIGTERM')
  const deadline = Date.now() + graceMs
  while (Date.now() < deadline && groupAlive(target)) await new Promise(resolve => setTimeout(resolve, 50))
  if (groupAlive(target)) {
    signal(target, 'SIGKILL')
    for (let attempt = 0; attempt < 20 && groupAlive(target); attempt += 1) await new Promise(resolve => setTimeout(resolve, 50))
  }
  return !groupAlive(target)
}

/** Pids `dshx dev up` recorded: a dev Host started before the registry existed has no record and no parent, by design. */
const devStatePids = async (root: string): Promise<ReadonlySet<number>> => {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const states = await Promise.all(
    entries.filter(entry => entry.isDirectory()).map(entry => ScratchStateRuntime.read(join(root, entry.name), entry.name).catch(() => undefined)),
  )
  return new Set(states.flatMap(state => (state === undefined ? [] : [state.host.pid])))
}

/**
 * Stop scratch Hosts whose owner is gone, drop records of Hosts that already exited, stop legacy orphans the registry
 * never knew (`--profile dshx-boot`, parent pid 1, older than `legacyMinAgeMs`). With
 * `dryRun`, report the same actions and change nothing.
 */
export const sweepScratch = async (options: {
  readonly dryRun: boolean
  readonly registryDir?: string
  readonly stateRoot?: string
  readonly legacyMinAgeMs?: number
  readonly graceMs?: number
  /** The process table to judge; a spec narrows it to the processes it started, so it never stops a real orphan. */
  readonly processes?: readonly ScratchProcess[]
}): Promise<SweepResult> => {
  const registryDir = options.registryDir ?? ScratchRegistry.directory()
  const stateRoot = options.stateRoot ?? ScratchStateRuntime.stateRoot()
  const graceMs = options.graceMs ?? 3_000
  const processes = options.processes ?? listProcesses()
  const byPid = new Map(processes.map(entry => [entry.pid, entry]))
  const records = await ScratchRegistry.readRecords(registryDir)
  const actions: SweepAction[] = []
  const live: ScratchRecord[] = []
  const leftRunning: number[] = []

  for (const record of records) {
    const host = byPid.get(record.hostPid)
    if (host === undefined || !ScratchRegistry.isSameProcessRunning(record.hostPid, record.hostStartedAt)) {
      actions.push({ kind: 'drop-record', target: `record ${String(record.hostPid)}`, reason: 'its Host already exited', pid: record.hostPid })
      if (!options.dryRun) await ScratchRegistry.removeRecord(record.hostPid, registryDir)
      continue
    }
    if (!ScratchRegistry.isOrphan(record)) {
      live.push(record)
      continue
    }
    if (!host.command.includes(SCRATCH_PROFILE_MARKER)) {
      actions.push({
        kind: 'skip',
        target: `pid ${String(host.pid)}`,
        reason: `its command line lacks "${SCRATCH_PROFILE_MARKER}"; not ours to stop`,
        pid: host.pid,
      })
      if (!options.dryRun) await ScratchRegistry.removeRecord(record.hostPid, registryDir)
      continue
    }
    actions.push({
      kind: 'stop-orphan',
      target: `pid ${String(host.pid)} (group ${String(host.pgid)})`,
      reason: `${record.kind} owner pid ${String(record.ownerPid)} from ${record.workspace} is gone`,
      pid: host.pid,
    })
    if (options.dryRun) continue
    if (!(await stopScratchProcess(host, graceMs))) leftRunning.push(host.pid)
    await ScratchRegistry.removeRecord(record.hostPid, registryDir)
  }

  const recorded = new Set(records.map(record => record.hostPid))
  const devPids = await devStatePids(stateRoot)
  const legacyMinAgeMs = options.legacyMinAgeMs ?? LEGACY_MIN_AGE_MS
  for (const candidate of processes) {
    if (!candidate.command.includes(SCRATCH_PROFILE_MARKER) || candidate.command.includes(GUARD_MARKER)) continue
    if (candidate.ppid !== 1 || candidate.ageMs < legacyMinAgeMs || candidate.pid === process.pid) continue
    if (recorded.has(candidate.pid) || devPids.has(candidate.pid)) continue
    actions.push({
      kind: 'stop-legacy',
      target: `pid ${String(candidate.pid)} (group ${String(candidate.pgid)})`,
      reason: `no owner record, parent pid 1, ${String(Math.round(candidate.ageMs / 60_000))} min old`,
      pid: candidate.pid,
    })
    if (!options.dryRun && !(await stopScratchProcess(candidate, graceMs))) leftRunning.push(candidate.pid)
  }

  return { actions, live, leftRunning }
}
