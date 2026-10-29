// Adapted from astahmer/nixfiles assets/dsh/supervise-web.mjs at 9daa1991c1d11f0689eac44171342b018f47cf6f.
// Keep its confirmed-request protocol; local differences are documented in supervise-dsh.UPSTREAM.md.
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { LauncherConfig } from './launcher-config.mjs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RESTART_EXIT_CODE = 75

export async function superviseDsh({ home, command, args, cwd, env = process.env, preparation = [], stdout = process.stdout, stderr = process.stderr }) {
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
      for (const step of preparation) {
        if (stopping) return stopCode
        const result = await new Promise((resolveStep, rejectStep) => {
          child = spawn(step.command, step.args, { cwd, env: { ...env, ...step.env }, detached: true, stdio: ['ignore', stdout, stderr] })
          child.once('error', rejectStep)
          child.once('exit', (code, signal) => resolveStep(code ?? (signal === 'SIGINT' ? 130 : 143)))
        })
        child = undefined
        if (stopping) return stopCode
        // Fail closed: never launch a new core with a partially rebuilt/linked profile.
        if (result !== 0) {
          warn(`Startup preparation failed (${result}); nothing started.`)
          return result
        }
      }
      if (stopping) return stopCode
      const runId = randomUUID()
      const requestPath = join(runtime, `dsh-web-restart-${runId}.request`)
      let urlWrites = Promise.resolve()
      const result = await new Promise((resolveRun, rejectRun) => {
        child = spawn(command, args, {
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
        child.once('exit', (code, signal) => resolveRun({ code: code ?? (signal === 'SIGINT' ? 130 : 143), signal }))
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
      if (stopping) return stopCode
      if (result.code === RESTART_EXIT_CODE && result.signal === null && requestedRun === runId) {
        warn('Restarting after a confirmed request; rebuilding/syncing before the next Host.')
        continue
      }
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
      args: ['--dir', root, 'exec', 'turbo', 'run', 'build', '--filter=./plugins/@dshfiles/*', '--concurrency=4', '--output-logs=errors-only'],
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
