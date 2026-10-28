import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
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
  return run('flock', ['-n', join(runtime, 'source-launch.lock'), config.nodeBinary, supervisor], { cwd: config.sourceRoot, env, stdio: 'inherit' })
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
