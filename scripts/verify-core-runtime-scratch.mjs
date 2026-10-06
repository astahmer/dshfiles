import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (process.versions.node !== '22.23.3') throw new Error(`Use Node 22.23.3 for DSH acceptance; found ${process.versions.node}.`)

const pnpmVersion = spawnSync('pnpm', ['--version'], { encoding: 'utf8' })
if (pnpmVersion.status !== 0 || pnpmVersion.stdout.trim() !== '12.5.1')
  throw new Error(`Use pnpm 12.5.1 for DSH acceptance; found ${pnpmVersion.stdout.trim() || 'unavailable'}.`)

const dshOutput = spawnSync('dsh', ['--version'], { encoding: 'utf8' })
if (dshOutput.status !== 0 || dshOutput.stdout.trim() !== '0.2.0-rc.2')
  throw new Error(`Scratch acceptance requires DSH 0.2.0-rc.2; found ${dshOutput.stdout.trim() || 'unavailable'}.`)

const helperPath = resolve(repoRoot, 'tooling/dshx/packages/dshx/dist/project/scratch-profile.js')
const clientPath = resolve(repoRoot, 'tooling/dshx/packages/dshx/dist/platform/index.js')
const { createScratchProfile, isolatedHostEnvironment, redactHostOutput } = await import(pathToFileURL(helperPath).href)
const { connectDshPlatformClient } = await import(pathToFileURL(clientPath).href)
const profileName = 'core-runtime'
const bridgePath = resolve(repoRoot, 'plugins/@dshfiles/dsh-core-runtime')
const cursorPluginPath = resolve(repoRoot, 'plugins/@dshfiles/cursor-agent')
const coreRoot = resolve(repoRoot, 'tooling/dsh-core')
const corePackages = ['agent', 'agent-loop', 'session', 'session-persistence', 'session-persistence-jsonl', 'session-format-catalog', 'session-format-v4-to-v5']
const extraDependencies = {
  '@dshfiles/dsh-core-runtime': `link:${bridgePath}`,
  '@dshfiles/cursor-agent': `link:${cursorPluginPath}`,
  ...Object.fromEntries(corePackages.map(name => [`@deepseek-ai/dsh-${name}`, `link:${resolve(coreRoot, name)}`])),
}

const scratch = await createScratchProfile({
  profileName,
  sourceProfileRoot: resolve(homedir(), '.dsh/profiles/web'),
  bundleIds: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dshfiles/dsh-core-runtime', '@dshfiles/cursor-agent'],
  excludedDependencyPrefixes: ['@dshfiles/', '@mars-sea/', 'dshmarket'],
  extraDependencies,
})

let host
let hostExited

const startHost = async () => {
  let output = ''
  const child = spawn(process.execPath, [resolve(repoRoot, 'scripts/core-runtime-scratch-host.mjs')], {
    cwd: repoRoot,
    env: { ...isolatedHostEnvironment(scratch.home, scratch.profileRoot), DSHX_BOOT_PROFILE_NAME: profileName },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  host = child
  hostExited = new Promise(resolveExit => child.once('close', (code, signal) => resolveExit({ code, signal })))
  const collect = chunk => {
    output = `${output}${chunk.toString('utf8')}`.slice(-64_000)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)

  await Promise.race([
    new Promise((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => {
        rejectReady(new Error(`Scratch Host did not print its ready URL within 45 seconds.\n${redactHostOutput(output.slice(-4_000))}`))
      }, 45_000)
      const inspect = () => {
        if (/http:\/\/127\.0\.0\.1:\d+\//.test(output)) {
          clearTimeout(timeout)
          resolveReady()
        }
      }
      child.stdout.on('data', inspect)
      child.stderr.on('data', inspect)
      child.once('error', error => {
        clearTimeout(timeout)
        rejectReady(new Error(`Scratch Host could not start: ${error.name}.`))
      })
      child.once('exit', (code, signal) => {
        if (!/http:\/\/127\.0\.0\.1:\d+\//.test(output)) {
          clearTimeout(timeout)
          rejectReady(new Error(`Scratch Host exited before ready: code=${String(code)}, signal=${String(signal)}.\n${redactHostOutput(output.slice(-4_000))}`))
        }
      })
    }),
    hostExited.then(({ code, signal }) => {
      throw new Error(`Scratch Host exited before ready: code=${String(code)}, signal=${String(signal)}.\n${redactHostOutput(output.slice(-4_000))}`)
    }),
  ])

  await new Promise(resolveDelay => setTimeout(resolveDelay, 500))
  const activationFailures = output.split('\n').filter(line => /failed to import|did not activate|pending \(waiting for service:/i.test(line))
  assert.deepEqual(activationFailures, [], redactHostOutput(activationFailures.join('\n')))
  const launchUrl = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/)?.[0]
  assert.ok(launchUrl, 'Scratch Host did not print its tokenized launch URL.')
  process.stdout.write('Scratch Host booted without activation failures.\n')
  return connectDshPlatformClient({ url: launchUrl })
}

const stopHost = async () => {
  const child = host
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  let timeout
  try {
    await Promise.race([
      hostExited,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Owned scratch Host did not stop within 5 seconds.')), 5_000)
      }),
    ])
  } catch (error) {
    child.kill('SIGKILL')
    await hostExited
    throw error
  } finally {
    clearTimeout(timeout)
  }
  host = undefined
}

try {
  await scratch.install()
  const platform = await startHost()
  const bundles = await platform.bundles.list()
  for (const name of ['@dshfiles/dsh-core-runtime', '@dshfiles/cursor-agent']) {
    assert.ok(
      bundles.some(bundle => bundle.name === name && bundle.installed),
      `Scratch profile did not activate ${name}.`,
    )
  }
  const created = await platform.sessions.create({ cwd: repoRoot })
  const initialSessions = await platform.sessions.list()
  assert.ok(
    initialSessions.some(session => session.sessionId === created.sessionId),
    'Host did not list the created Session.',
  )
  const initialHistory = await platform.sessions.history(created.sessionId)

  await stopHost()

  const restartedPlatform = await startHost()
  const restartedSessions = await restartedPlatform.sessions.list()
  assert.ok(
    restartedSessions.some(session => session.sessionId === created.sessionId),
    'Session was missing after Host restart.',
  )
  const restartedHistory = await restartedPlatform.sessions.history(created.sessionId)
  assert.deepEqual(restartedHistory.records, initialHistory.records, 'Session history changed across Host restart.')
  process.stdout.write(`PASS: local Agent and Cursor runtime loaded; Session survived Host restart with ${restartedHistory.records.length} history records.\n`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${redactHostOutput(message)}\n`)
  process.exitCode = 1
} finally {
  await stopHost().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${redactHostOutput(message)}\n`)
    process.exitCode = 1
  })
  await scratch.cleanup()
}
