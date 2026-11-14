// Adapted from astahmer/nixfiles assets/dsh/supervise-web.mjs at 9daa1991c1d11f0689eac44171342b018f47cf6f.
// Keep its confirmed-request protocol; local differences are documented in supervise-dsh.UPSTREAM.md.
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:os'
import { LauncherConfig } from './launcher-config.mjs'
import { activeSafeProfile } from './safe-mode.mjs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RESTART_EXIT_CODE = 75

/** The status a shell reports: the exit code, or 128 + the signal number (SIGSEGV is 139, SIGKILL 137, SIGTERM 143). */
const exitStatus = (code, signal) => code ?? 128 + (constants.signals[signal] ?? constants.signals.SIGTERM)
const describeExit = (code, signal) => (signal === null ? `exit code ${code}` : `signal ${signal} (status ${exitStatus(code, signal)})`)

export async function superviseDsh({
  home,
  command,
  args,
  cwd,
  env = process.env,
  preparation = [],
  plan = () => ({ args, preparation }),
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  const runtime = join(resolve(home), 'runtime')
  await mkdir(runtime, { recursive: true, mode: 0o700 })
  const webUrlPath = join(runtime, 'web-url')
  let child
  let stopping = false
  let stopCode = 0
  const warn = message => stderr.write(`[dsh-supervisor] ${message}\n`)
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
    warn(`Supervisor received ${signal}; stopping the Host and not restarting it.`)
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
      const current = plan()
      if (current.notice) warn(current.notice)
      for (const step of current.preparation) {
        if (stopping) return stopCode
        const result = await new Promise((resolveStep, rejectStep) => {
          child = spawn(step.command, step.args, { cwd, env: { ...env, ...step.env }, detached: true, stdio: ['ignore', stdout, stderr] })
          child.once('error', rejectStep)
          child.once('exit', (code, signal) => resolveStep({ code, signal }))
        })
        child = undefined
        if (stopping) return stopCode
        // Fail closed: never launch a new core with a partially rebuilt/linked profile.
        if (result.code !== 0) {
          warn(`Startup preparation failed (${describeExit(result.code, result.signal)}); nothing started.`)
          return exitStatus(result.code, result.signal)
        }
      }
      if (stopping) return stopCode
      const runId = randomUUID()
      const requestPath = join(runtime, `dsh-web-restart-${runId}.request`)
      let urlWrites = Promise.resolve()
      const result = await new Promise((resolveRun, rejectRun) => {
        child = spawn(command, current.args, {
          cwd,
          detached: true,
          env: { ...env, DSH_HOME: resolve(home), DSH_RESTART_REQUEST_PATH: requestPath, DSH_RESTART_RUN_ID: runId },
          stdio: ['inherit', 'pipe', stderr],
        })
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
        child.once('exit', (code, signal) => resolveRun({ code, signal, pid: child.pid }))
      })
      child = undefined
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
      // Lifecycle facts only: never argv, environment, URLs or request contents.
      const request = requestedRun === runId ? 'confirmed' : requestedRun === '' ? 'absent' : 'mismatched'
      warn(`Host ${result.pid} ended with ${describeExit(result.code, result.signal)}; restart request ${request}.`)
      if (stopping) return stopCode
      if (result.code === RESTART_EXIT_CODE && result.signal === null && request === 'confirmed') {
        warn('Restarting after a confirmed request; rebuilding/syncing before the next Host.')
        continue
      }
      if (result.signal !== null && request === 'confirmed') {
        warn(
          `The Host asked for a restart but died by ${result.signal} before exiting with ${RESTART_EXIT_CODE}, so DSH stays stopped. ` +
            `Start it again with dsh; on Linux, coredumpctl info ${result.pid} shows where it crashed.`,
        )
      }
      return exitStatus(result.code, result.signal)
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
  const pnpm = LauncherConfig.pnpm(config)
  const fullPreparation = [
    { command: pnpm.command, env: pnpm.env, args: [...pnpm.prefix, '--dir', root, 'install', '--frozen-lockfile', '--prefer-offline'] },
    {
      command: pnpm.command,
      env: pnpm.env,
      args: [
        ...pnpm.prefix,
        '--dir',
        root,
        'exec',
        'node',
        join(root, 'scripts/turbo.mjs'),
        'run',
        'build',
        '--filter=./plugins/@dshfiles/*',
        '--output-logs=errors-only',
      ],
    },
    { command: config.nodeBinary, args: [join(root, 'scripts/prepare-manuel-source.mjs')] },
    // A build that passes is not a start that works: compose the profile on the core that will run it, check Node and
    // the saved agent presets, and migrate recorded preset changes, before any Host starts.
    { command: config.nodeBinary, args: [join(root, 'scripts/dsh-preflight.mjs'), '--apply'] },
  ]
  // Safe mode boots its sibling profile without building or relinking: a broken plugin build must not block recovery.
  const plan = () => {
    const safe = activeSafeProfile({ home, profile: config.profile })
    if (safe === undefined) return { args: [core, '--profile', config.profile, '--no-open'], preparation: fullPreparation }
    return {
      args: [core, '--profile', safe, '--no-open'],
      preparation: [],
      notice: `Safe mode: booting ${safe} with plugins off. Restore: node ${join(root, 'scripts/safe-mode.mjs')} stop --profile ${config.profile}`,
    }
  }
  process.exitCode = await superviseDsh({ home, command: config.nodeBinary, cwd: root, plan })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'DSH supervisor failed')
    process.exitCode = 1
  })
}
