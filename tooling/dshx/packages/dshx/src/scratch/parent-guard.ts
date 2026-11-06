import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { constants } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

/**
 * `node parent-guard.js [--pipe] [--record-kind e2e|dev --record-dir <dir>] [--grace-ms N] -- <command> [args...]`
 *
 * Runs one scratch process (a `dsh --profile dshx-boot` Host, its Chromium helper, a fake provider) so it cannot outlive
 * whoever started it. The parent spawns this guard detached, so the guard leads a new process group and the guarded
 * command joins it. The guard stops the whole group — SIGTERM, then SIGKILL after `--grace-ms` because a busy Host has
 * been seen ignoring SIGTERM for minutes — as soon as:
 *
 * - `--pipe`: its stdin reaches EOF. The parent holds the write end, and the kernel closes it however the parent died
 *   (SIGKILL included), which no `exit` handler in the parent can promise. A `release` line hands ownership over: later
 *   EOF is ignored.
 * - the owner named by `DSHX_SCRATCH_OWNER` (`<pid>:<startedAtMs>:<workspace>`) is gone, or its pid now belongs to a
 *   process that started at another time.
 *
 * With `--record-kind`, it also writes `<record-dir>/<pid>.json` for the guarded command (see `registry.ts`) and removes
 * it when the command exits. This file runs from `dist/` and, from the E2E sources, through Node's type stripping, so
 * it imports only Node built-ins.
 */
const OWNER_POLL_MS = 1_000
const OWNER_IDENTITY_EVERY = 15
const START_TOLERANCE_MS = 2_000

const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: true,
  options: {
    pipe: { type: 'boolean' },
    'record-kind': { type: 'string' },
    'record-dir': { type: 'string' },
    'grace-ms': { type: 'string' },
  },
})
const [command, ...commandArgs] = positionals
if (command === undefined) {
  process.stderr.write('Usage: parent-guard.js [--pipe] [--record-kind e2e|dev --record-dir <dir>] [--grace-ms N] -- <command> [args...]\n')
  process.exit(2)
}
const graceMs = Number(values['grace-ms'] ?? 3_000)

const processStartedAt = (pid: number): number | undefined => {
  const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
  const startedAt = Date.parse(result.stdout.trim().replace(/\s+/g, ' '))
  return result.status === 0 && Number.isFinite(startedAt) ? startedAt : undefined
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

const ownerMatch = /^(\d+):(\d+):(.*)$/s.exec(process.env.DSHX_SCRATCH_OWNER ?? '')
const owner = ownerMatch === null ? undefined : { pid: Number(ownerMatch[1]), startedAt: Number(ownerMatch[2]), workspace: ownerMatch[3] ?? '' }

const child = spawn(command, commandArgs, { stdio: ['ignore', 'inherit', 'inherit'] })

const recordKind = values['record-kind']
const recordDir = values['record-dir']
const recordFile = recordKind !== undefined && recordDir !== undefined && child.pid !== undefined ? join(recordDir, `${child.pid}.json`) : undefined
if (recordFile !== undefined && recordDir !== undefined && child.pid !== undefined && owner !== undefined) {
  try {
    mkdirSync(recordDir, { recursive: true, mode: 0o700 })
    const record = {
      hostPid: child.pid,
      hostStartedAt: processStartedAt(child.pid) ?? Date.now(),
      ownerPid: owner.pid,
      ownerStartedAt: owner.startedAt,
      workspace: owner.workspace,
      kind: recordKind,
      command: [command, ...commandArgs].join(' '),
    }
    writeFileSync(recordFile, `${JSON.stringify(record)}\n`, { mode: 0o600 })
  } catch (error) {
    process.stderr.write(`[parent-guard] could not write ${recordFile}: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}
const removeRecord = (): void => {
  if (recordFile !== undefined) rmSync(recordFile, { force: true })
}

const signalGroup = (signal: NodeJS.Signals): void => {
  try {
    process.kill(-process.pid, signal)
  } catch {
    // Not a group leader (the parent did not detach the guard): reach the command by its own pid.
    if (child.pid !== undefined)
      try {
        process.kill(child.pid, signal)
      } catch {
        // Already gone.
      }
  }
}

let stopping = false
const stop = (reason: string): void => {
  if (stopping) return
  stopping = true
  process.stderr.write(`[parent-guard] ${reason}; stopping pid ${String(child.pid)} and its process group\n`)
  signalGroup('SIGTERM')
  setTimeout(() => {
    removeRecord()
    signalGroup('SIGKILL')
  }, graceMs)
}

// The group SIGTERM reaches the guard too: it only means "stop the command", and the guard exits once it has.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => stop(`received ${signal}`))

if (values.pipe === true) {
  let released = false
  let received = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    received = `${received}${chunk}`.slice(-64)
    if (received.split('\n').some(line => line.trim() === 'release')) released = true
  })
  const ownerPipeClosed = (): void => {
    if (!released) stop('the owner pipe closed')
  }
  process.stdin.once('end', ownerPipeClosed)
  process.stdin.once('error', ownerPipeClosed)
}

let ownerTicks = 0
const ownerPoll =
  owner === undefined
    ? undefined
    : setInterval(() => {
        ownerTicks += 1
        if (!isAlive(owner.pid)) return stop(`owner pid ${String(owner.pid)} exited`)
        if (ownerTicks % OWNER_IDENTITY_EVERY !== 0) return
        const startedAt = processStartedAt(owner.pid)
        if (startedAt !== undefined && Math.abs(startedAt - owner.startedAt) > START_TOLERANCE_MS)
          stop(`owner pid ${String(owner.pid)} now belongs to another process`)
      }, OWNER_POLL_MS)
if (owner !== undefined && !isAlive(owner.pid)) stop(`owner pid ${String(owner.pid)} is already gone`)

child.once('error', error => {
  process.stderr.write(`[parent-guard] ${command} did not start: ${error.message}\n`)
  removeRecord()
  process.exit(127)
})

child.once('exit', (code, signal) => {
  if (ownerPoll !== undefined) clearInterval(ownerPoll)
  removeRecord()
  // A stop takes the rest of the group (helpers the command started) down with it.
  if (stopping) signalGroup('SIGKILL')
  process.exit(code ?? 128 + (signal === null ? 1 : constants.signals[signal]))
})
