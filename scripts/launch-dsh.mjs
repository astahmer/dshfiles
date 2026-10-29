import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LauncherConfig } from './launcher-config.mjs'

const run = (command, args, options) =>
  new Promise((resolveExit, reject) => {
    const child = spawn(command, args, { ...options, detached: true })
    const forward = signal => {
      if (child.exitCode !== null || !child.pid) return
      try {
        process.kill(-child.pid, signal)
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
    const interrupt = () => forward('SIGINT')
    const terminate = () => forward('SIGTERM')
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    const cleanup = () => {
      process.off('SIGINT', interrupt)
      process.off('SIGTERM', terminate)
    }
    child.once('error', error => {
      cleanup()
      reject(error)
    })
    child.once('exit', (code, signal) => {
      cleanup()
      resolveExit(code ?? (signal === 'SIGINT' ? 130 : 143))
    })
  })

const processAlive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * Hold an exclusive launch lock without `flock(1)`, which macOS does not ship. A lock left by a process that no longer
 * exists is taken over; a live holder fails fast like `flock -n`.
 */
const acquireLaunchLock = path => {
  try {
    const descriptor = openSync(path, 'wx', 0o600)
    writeSync(descriptor, `${process.pid}\n`)
    closeSync(descriptor)
    return () => rmSync(path, { force: true })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const holder = Number.parseInt(readFileSync(path, 'utf8'), 10)
  if (Number.isInteger(holder) && processAlive(holder)) throw new Error('DSH is already launching; nothing started')
  rmSync(path, { force: true })
  return acquireLaunchLock(path)
}

export async function launchDsh(args, config = LauncherConfig.load(), inherited = process.env) {
  const core = LauncherConfig.requireCoreEntry(config)
  const env = LauncherConfig.environment(config, inherited)
  if (!existsSync(core) || !statSync(core).isFile() || !existsSync(config.nodeBinary)) throw new Error('Configured runtime is missing; nothing started')
  if (config.homeVerificationFile && !existsSync(config.homeVerificationFile)) throw new Error('Configured DSH home verification is missing; nothing started')
  if (args.length) return run(config.nodeBinary, [core, ...args], { env, stdio: 'inherit' })
  const supervisor = join(config.sourceRoot, 'scripts/supervise-dsh.mjs')
  if (!existsSync(supervisor) || !existsSync(join(config.sourceRoot, 'scripts/prepare-manuel-source.mjs')))
    throw new Error('Configured source checkout is missing; nothing started')
  // Check before any build/profile write. Preparation repeats this check under the launch lock.
  const running = await run('pgrep', ['-u', String(process.getuid()), '-f', LauncherConfig.runningProfilePattern(config)], { env, stdio: 'ignore' })
  if (running === 0) throw new Error('DSH is already running; no build or profile change performed')
  if (running !== 1) throw new Error('Could not check running DSH processes; nothing started')
  const runtime = join(config.dshHome, 'runtime')
  mkdirSync(runtime, { recursive: true, mode: 0o700 })
  const release = acquireLaunchLock(join(runtime, 'source-launch.lock'))
  try {
    return await run(config.nodeBinary, [supervisor], { cwd: config.sourceRoot, env, stdio: 'inherit' })
  } finally {
    release()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077)
  launchDsh(process.argv.slice(2))
    .then(code => {
      process.exitCode = code
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : 'DSH launch failed')
      process.exitCode = 1
    })
}
