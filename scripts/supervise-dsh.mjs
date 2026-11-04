// Adapted from astahmer/nixfiles assets/dsh/supervise-web.mjs at 9daa1991c1d11f0689eac44171342b018f47cf6f.
// Keep its confirmed-request protocol; local differences are documented in supervise-dsh.UPSTREAM.md.
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { LauncherConfig } from './launcher-config.mjs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RESTART_EXIT_CODE = 75
// The Host forces its own exit 10 s after a managed restart asks DSH to exit; this is the backstop for a Host that
// wrote its request but hangs before that guard runs. A request alone is never enough to restart: see below.
const REQUESTED_EXIT_GRACE_MS = 30_000
const KILL_GRACE_MS = 5_000
const REQUEST_POLL_MS = 500

export async function superviseDsh({
  home,
  command,
  args,
  cwd,
  env = process.env,
  preparation = [],
  stdout = process.stdout,
  stderr = process.stderr,
  /** Where supervisor lines go; defaults to stderr. Child output always uses the stdout/stderr streams. */
  log = stderr,
  requestedExitGraceMs = REQUESTED_EXIT_GRACE_MS,
  killGraceMs = KILL_GRACE_MS,
}) {
  const runtime = join(resolve(home), 'runtime')
  await mkdir(runtime, { recursive: true, mode: 0o700 })
  const webUrlPath = join(runtime, 'web-url')
  let child
  let stopping = false
  let stopCode = 0
  const warn = message => log.write(`[dsh-supervisor] ${message}\n`)
  const signalChild = signal => {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
    try {
      process.kill(-child.pid, signal)
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
  const stop = signal => {
    if (stopping) return
    stopping = true
    stopCode = signal === 'SIGINT' ? 130 : 143
    signalChild(signal)
  }
  const onInterrupt = () => stop('SIGINT')
  const onTerminate = () => stop('SIGTERM')
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onTerminate)
  try {
    for (;;) {
      for (const [index, step] of preparation.entries()) {
        if (stopping) return stopCode
        warn(`Preparing the Host (${index + 1}/${preparation.length}): ${[step.command, ...step.args].map(part => part.split('/').pop()).join(' ')}`)
        const result = await new Promise((resolveStep, rejectStep) => {
          child = spawn(step.command, step.args, { cwd, env: { ...env, ...step.env }, detached: true, stdio: ['ignore', stdout, stderr] })
          child.once('error', rejectStep)
          child.once('exit', (code, signal) => resolveStep(code ?? (signal === 'SIGINT' ? 130 : 143)))
        })
        child = undefined
        if (stopping) return stopCode
        // Fail closed: never launch a new core with a partially rebuilt/linked profile.
        if (result !== 0) {
          warn(`Startup preparation failed (exit ${result}); nothing started. Fix the step above, then run dsh again.`)
          return result
        }
      }
      if (stopping) return stopCode
      const runId = randomUUID()
      const requestPath = join(runtime, `dsh-web-restart-${runId}.request`)
      let urlWrites = Promise.resolve()
      let forcedAfterRequest = false
      const timers = new Set()
      const clearTimers = () => {
        for (const timer of timers) clearTimeout(timer)
        timers.clear()
      }
      const result = await new Promise((resolveRun, rejectRun) => {
        child = spawn(command, args, {
          cwd,
          detached: true,
          env: { ...env, DSH_HOME: resolve(home), DSH_RESTART_REQUEST_PATH: requestPath, DSH_RESTART_RUN_ID: runId },
          stdio: ['inherit', 'pipe', stderr],
        })
        // oxlint-disable-next-line antislop/no-passthrough-variable -- Snapshot of this run's child: `child` is cleared and reassigned for the next run while these timers may still fire.
        const running = child
        if (running.pid !== undefined) warn(`Host started (pid ${running.pid}, run ${runId}).`)
        // A Host that wrote its restart request must exit soon; one that does not is stopped so the restart happens.
        const watchRequest = () => {
          const timer = setTimeout(async () => {
            timers.delete(timer)
            if (running.exitCode !== null || running.signalCode !== null || stopping) return
            const requested = await readFile(requestPath, 'utf8').catch(() => '')
            if (requested !== runId) return watchRequest()
            const stopTimer = setTimeout(() => {
              timers.delete(stopTimer)
              if (running.exitCode !== null || running.signalCode !== null || stopping) return
              forcedAfterRequest = true
              warn(
                `The Host asked for a restart ${Math.round(requestedExitGraceMs / 1000)} s ago but is still running (pid ${running.pid}); stopping it with SIGTERM.`,
              )
              signalChild('SIGTERM')
              const killTimer = setTimeout(() => {
                timers.delete(killTimer)
                if (running.exitCode !== null || running.signalCode !== null) return
                warn(`The Host ignored SIGTERM for ${Math.round(killGraceMs / 1000)} s; sending SIGKILL.`)
                signalChild('SIGKILL')
              }, killGraceMs)
              timers.add(killTimer)
            }, requestedExitGraceMs)
            timers.add(stopTimer)
          }, REQUEST_POLL_MS)
          timers.add(timer)
        }
        watchRequest()
        let lineBuffer = ''
        child.stdout.on('data', chunk => {
          stdout.write(chunk)
          lineBuffer += String(chunk)
          const lines = lineBuffer.split('\n')
          lineBuffer = lines.pop()?.slice(-16_384) ?? ''
          for (const line of lines) {
            const url = /^dsh [^:]+: (http:\/\/\S+\?token=\S+)$/.exec(line.trim())?.[1]
            if (url) urlWrites = urlWrites.then(() => writeFile(webUrlPath, `${url}\n`, { mode: 0o600 })).catch(() => undefined)
          }
        })
        child.once('error', rejectRun)
        child.once('exit', (code, signal) => resolveRun({ code: code ?? (signal === 'SIGINT' ? 130 : 143), signal }))
      })
      child = undefined
      clearTimers()
      await urlWrites
      await unlink(webUrlPath).catch(error => {
        if (error.code !== 'ENOENT') throw error
      })
      const requestedRun = await readFile(requestPath, 'utf8').catch(error => {
        if (error.code === 'ENOENT') return ''
        throw error
      })
      await unlink(requestPath).catch(error => {
        if (error.code !== 'ENOENT') throw error
      })
      if (stopping) return stopCode
      warn(`Host exited (${result.signal === null ? `code ${result.code}` : `signal ${result.signal}`}).`)
      if (requestedRun === runId && ((result.code === RESTART_EXIT_CODE && result.signal === null) || forcedAfterRequest)) {
        warn('Restarting after a confirmed request; rebuilding/syncing before the next Host.')
        continue
      }
      if (result.code === RESTART_EXIT_CODE) warn('Exit 75 without a matching restart request from this run; not restarting. Run dsh again to start DSH.')
      return result.code
    }
  } finally {
    process.off('SIGINT', onInterrupt)
    process.off('SIGTERM', onTerminate)
    signalChild('SIGTERM')
  }
}

async function main() {
  const config = LauncherConfig.load()
  const root = config.sourceRoot
  const home = config.dshHome
  const core = LauncherConfig.requireCoreEntry(config)
  const preparation = [
    { command: 'pnpm', args: ['--dir', root, 'install', '--frozen-lockfile', '--prefer-offline'] },
    {
      command: 'pnpm',
      args: ['--dir', root, 'exec', 'node', join(root, 'scripts/turbo.mjs'), 'run', 'build', '--filter=./plugins/@dshfiles/*', '--output-logs=errors-only'],
    },
    { command: config.nodeBinary, args: [join(root, 'scripts/prepare-manuel-source.mjs')] },
  ]
  process.exitCode = await superviseDsh({
    home,
    command: config.nodeBinary,
    args: [core, '--profile', config.profile, '--no-open'],
    cwd: root,
    preparation,
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'DSH supervisor failed')
    process.exitCode = 1
  })
}
