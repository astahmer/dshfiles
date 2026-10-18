#!/usr/bin/env node

/**
 * Reaps scratch processes a browser run leaked.
 *
 * A journey or boot check owns a scratch Host (`dsh --profile dshx-boot`) and sometimes a fake provider; the harness
 * stops both in its `After` hook. A run that is cancelled — Ctrl-C, a stopped job, a killed worker, Turbo aborting the
 * graph — never reaches that hook, and the Host is re-parented to pid 1 and keeps a port, ~30 MB and a slice of CPU.
 * Thirteen such Hosts and twelve fake providers were measured, the oldest 23 hours old, and they slow every later boot
 * and make the timing-sensitive journeys flakier.
 *
 * The sweep never guesses from a command line, because `dshx dev up` deliberately daemonizes a Host with the *same*
 * profile and its own pid 1: anything matched by shape alone would take a live development session down with it. The
 * harness records every Host it spawns in a ledger (`.turbo/e2e-scratch-hosts.jsonl`), and the sweep reaps a recorded
 * pid only while it is parentless and still matches the recorded command signature. An entry whose signature no longer
 * matches is a reused pid and is dropped, not killed.
 *
 *   node tooling/dshx/scripts/reap-scratch-processes.mjs [--workspace DIR] [--dry-run] [--min-age-seconds N] [--quiet]
 *   node tooling/dshx/scripts/reap-scratch-processes.mjs --patterns '--profile dshx-boot' --min-age-minutes 60
 *
 * `--patterns` is the blunt instrument: it also matches a live `dshx dev up` Host, so it stays off by default.
 */

import { execFile } from 'node:child_process'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const defaultWorkspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/** Command-line markers this repository owns, for the opt-in pattern sweep. */
export const defaultScratchPatterns = ['--profile dshx-boot', 'fake-provider-main.js']

/** A Host is only reaped once its own run had time to stop it: the `After` hook can take seconds. */
export const defaultMinAgeMs = 60_000

export const scratchLedgerPath = workspaceRoot => resolve(workspaceRoot, '.turbo/e2e-scratch-hosts.jsonl')

const elapsedUnits = [
  { pattern: /^(\d+)-(\d+):(\d+):(\d+)$/, factors: [86_400_000, 3_600_000, 60_000, 1_000] },
  { pattern: /^(\d+):(\d+):(\d+)$/, factors: [3_600_000, 60_000, 1_000] },
  { pattern: /^(\d+):(\d+)$/, factors: [60_000, 1_000] },
]

/** `ps` elapsed time (`[[dd-]hh:]mm:ss`) in milliseconds. */
export const parseElapsed = text => {
  for (const { pattern, factors } of elapsedUnits) {
    const match = pattern.exec(text)
    if (match === null) continue
    return match.slice(1).reduce((total, part, index) => total + Number(part) * factors[index], 0)
  }
  return undefined
}

/**
 * Every process on the machine, or the ones whose command line carries one of `patterns`. `ps -ww` matters: without it
 * the command is truncated at the terminal width, and a `--profile dshx-boot` marker sits past 100 characters of node
 * path.
 */
export const listScratchProcesses = async ({ patterns } = {}) => {
  const { stdout } = await run('ps', ['-axww', '-o', 'pid=,ppid=,etime=,command='])
  return stdout.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (match === null) return []
    const [, pid, ppid, elapsed, command] = match
    if (patterns !== undefined && !patterns.some(pattern => command.includes(pattern))) return []
    const ageMs = parseElapsed(elapsed)
    return ageMs === undefined ? [] : [{ pid: Number(pid), ppid: Number(ppid), ageMs, command }]
  })
}

/** Record one process this run spawned, so a later run can reap it if this one is killed before it stops it. */
export const recordScratchProcess = async ({ ledgerPath, pid, signature, kind = 'scratch-host' }) => {
  if (pid === undefined) return
  try {
    await appendFile(ledgerPath, `${JSON.stringify({ pid, signature, kind, startedAt: Date.now() })}\n`)
  } catch {
    // A run must not fail because its leak ledger is unwritable; the process still stops through the normal path.
  }
}

const readLedger = async ledgerPath => {
  const text = await readFile(ledgerPath, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })
  return text.split('\n').flatMap(line => {
    const trimmed = line.trim()
    if (trimmed === '') return []
    try {
      const entry = JSON.parse(trimmed)
      return typeof entry?.pid === 'number' && typeof entry?.signature === 'string' ? [entry] : []
    } catch {
      return []
    }
  })
}

const isMissingProcess = error => error instanceof Error && 'code' in error && error.code === 'ESRCH'

const isAlive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return isMissingProcess(error) ? false : true
  }
}

/**
 * Signal the process group and the pid: the harness spawns its Hosts detached, so the pid leads a group, while a
 * process another parent started is reached by its own pid. A missing target is not an error.
 */
const signalScratchProcess = (pid, signal) => {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, signal)
    } catch (error) {
      if (!isMissingProcess(error)) throw error
    }
  }
}

export const killScratchProcess = async (pid, { graceMs = 2_000 } = {}) => {
  if (!isAlive(pid)) return
  signalScratchProcess(pid, 'SIGTERM')
  const deadline = Date.now() + graceMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return
    await new Promise(resolveWait => setTimeout(resolveWait, 25))
  }
  signalScratchProcess(pid, 'SIGKILL')
}

/**
 * Reap the processes this workspace's runs recorded and did not stop: parentless, old enough, and still matching the
 * signature written when they were spawned. Returns what it reaped (or would reap with `dryRun`), and compacts the
 * ledger down to the entries that are still live.
 */
export const reapRecordedScratchProcesses = async options => {
  const { ledgerPath, dryRun = false, minAgeMs = defaultMinAgeMs, kill = killScratchProcess } = options
  const entries = await readLedger(ledgerPath)
  if (entries.length === 0) return []
  const processes = await listScratchProcesses()
  const byPid = new Map(processes.map(process_ => [process_.pid, process_]))
  const reaped = []
  const surviving = []
  for (const entry of entries) {
    const process_ = byPid.get(entry.pid)
    // Gone, or a reused pid that no longer runs what we recorded: drop the entry either way.
    if (process_ === undefined || !process_.command.includes(entry.signature)) continue
    if (process_.pid === process.pid || process_.ppid !== 1 || process_.ageMs < minAgeMs) {
      surviving.push(entry)
      continue
    }
    if (!dryRun) await kill(process_.pid)
    reaped.push({ ...process_, signature: entry.signature })
  }
  if (!dryRun) await writeFile(ledgerPath, surviving.map(entry => `${JSON.stringify(entry)}\n`).join('')).catch(() => undefined)
  return reaped
}

/**
 * The blunt sweep: every parentless process whose command matches `patterns`, whatever spawned it. It cannot tell an
 * abandoned Host from a live `dshx dev up` one, so callers opt in and choose an age floor that suits them.
 */
export const reapScratchProcesses = async (options = {}) => {
  const { dryRun = false, minAgeMs = defaultMinAgeMs, patterns = defaultScratchPatterns, kill = killScratchProcess } = options
  const orphans = (await listScratchProcesses({ patterns })).filter(
    process_ => process_.ppid === 1 && process_.pid !== process.pid && process_.ageMs >= minAgeMs,
  )
  for (const orphan of orphans) {
    if (dryRun) continue
    await kill(orphan.pid)
  }
  return orphans
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes('--dry-run')
  const quiet = process.argv.includes('--quiet')
  const valueOf = flag => {
    const index = process.argv.indexOf(flag)
    return index === -1 ? undefined : process.argv[index + 1]
  }
  const workspaceRoot = valueOf('--workspace') ?? defaultWorkspaceRoot
  const minutes = valueOf('--min-age-minutes')
  const seconds = valueOf('--min-age-seconds')
  const patternFlag = valueOf('--patterns')
  const minAgeMs = minutes !== undefined ? Number(minutes) * 60_000 : seconds !== undefined ? Number(seconds) * 1_000 : defaultMinAgeMs
  if (Number.isNaN(minAgeMs)) {
    console.error('reap-scratch-processes: --min-age-minutes/--min-age-seconds needs a number')
    process.exit(2)
  }
  const reaped =
    patternFlag === undefined
      ? await reapRecordedScratchProcesses({ ledgerPath: scratchLedgerPath(workspaceRoot), dryRun, minAgeMs })
      : await reapScratchProcesses({ dryRun, minAgeMs, patterns: patternFlag.split(',') })
  if (!quiet) {
    console.log(`reap-scratch-processes: ${dryRun ? 'would reap' : 'reaped'} ${String(reaped.length)} scratch process(es)`)
    for (const process_ of reaped)
      console.log(`  ${String(process_.pid)} (${String(Math.round(process_.ageMs / 60_000))}m old) ${process_.command.slice(0, 120)}`)
  }
}
