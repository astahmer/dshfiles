import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, resolve } from 'node:path'
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
const cursorInstanceId = 'scratch-fixture'
const cursorCredential = 'scratch-only-cursor-fixture'
const corePackages = ['api-session-controller', 'agent', 'agent-loop', 'session', 'session-persistence', 'session-persistence-jsonl', 'session-format-catalog', 'session-format-v4-to-v5']
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
const cursorExecutableDirectory = resolve(scratch.home, 'bin')
const cursorExecutablePath = resolve(cursorExecutableDirectory, 'agent')
const cursorLauncherPath = resolve(scratch.home, 'cursor-acp-launcher.mjs')
const cursorLaunchMarkerPath = resolve(scratch.home, 'cursor-acp-launcher-state')
const cursorFixturePath = resolve(repoRoot, 'plugins/@dshfiles/cursor-agent/tests/fixtures/fake-cursor-acp.mjs')
const cursorOverlayPath = resolve(scratch.home, 'cursor-runtime.patch.yml')
const cursorProjectRoot = resolve(scratch.home, 'cursor-project')
const cursorEventsPath = resolve(scratch.home, 'runtime-drivers', 'cursor-acp', cursorInstanceId, 'fixture-events.jsonl')
await mkdir(cursorExecutableDirectory, { recursive: true })
await mkdir(cursorProjectRoot, { recursive: true })
await writeFile(
  cursorLauncherPath,
  `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(cursorLaunchMarkerPath)}, 'started')\ntry {\n  await import(${JSON.stringify(pathToFileURL(cursorFixturePath).href)})\n} catch (error) {\n  const message = error instanceof Error ? error.message : ''\n  const failure = message.includes('Scratch Cursor fixture requires') ? 'invalid-fixture-environment' : message.includes('only supports ACP mode') ? 'wrong-acp-argument' : 'fixture-import-failed'\n  writeFileSync(${JSON.stringify(cursorLaunchMarkerPath)}, 'failed:' + failure)\n  process.exitCode = 1\n}\n`,
)
await writeFile(cursorExecutablePath, `#!/bin/sh\nexec "${process.execPath}" "${cursorLauncherPath}" "$@"\n`, { mode: 0o700 })
await chmod(cursorExecutablePath, 0o700)
await writeFile(
  cursorOverlayPath,
  `- id: dshfiles-cursor-agent\n  name: '@dshfiles/cursor-agent'\n  config:\n    instances:\n      - id: ${cursorInstanceId}\n        label: Scratch ACP fixture\n        credentialRef: CURSOR_API_KEY\n        credentialKind: api-key\n`,
)

let host
let hostExited

const startHost = async () => {
  let output = ''
  const environment = isolatedHostEnvironment(scratch.home, scratch.profileRoot)
  const child = spawn(process.execPath, [resolve(repoRoot, 'scripts/core-runtime-scratch-host.mjs')], {
    cwd: repoRoot,
    env: {
      ...environment,
      DSHX_BOOT_PROFILE_NAME: profileName,
      DSHX_BOOT_PATCH_FILE: cursorOverlayPath,
      DSHX_SCRATCH_CURSOR_CREDENTIAL: cursorCredential,
      PATH: [cursorExecutableDirectory, environment.PATH].filter(Boolean).join(delimiter),
    },
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

const waitForHistoryText = async (platform, sessionId, text) => {
  const expiresAt = Date.now() + 15_000
  while (Date.now() < expiresAt) {
    const history = await platform.sessions.history(sessionId)
    if (JSON.stringify(history.records).includes(text)) return history
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
  }
  const history = await platform.sessions.history(sessionId)
  const sessionEvents = history.records.map(record => {
    const event = record.event ?? record
    const type = typeof event.type === 'string' ? event.type : 'unknown'
    if (type !== 'turn/end') return type
    const reason = event.data?.reason
    if (reason?.kind !== 'error') return `${type}:${reason?.kind ?? 'unknown'}`
    const message = typeof reason.error?.message === 'string' ? reason.error.message : ''
    const failure = message.includes('Cursor runtime instance is not configured')
      ? 'cursor-instance-not-configured'
      : message.includes('Cursor runtime credential is not configured')
        ? 'cursor-credential-not-configured'
        : message.includes('Cursor CLI executable is unavailable')
          ? 'cursor-executable-unavailable'
          : message.includes('Cursor ACP session startup failed')
            ? 'cursor-acp-startup-failed'
            : message.includes('Cursor ACP prompt failed')
              ? 'cursor-acp-prompt-failed'
              : 'unclassified'
    return `${type}:error:${reason.error?.code ?? 'UNKNOWN'}:${failure}`
  })
  const cursorEventTypes = await readFile(cursorEventsPath, 'utf8')
    .then(contents => contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line).type))
    .catch(() => [])
  const cursorLaunchState = await readFile(cursorLaunchMarkerPath, 'utf8').catch(() => 'not-launched')
  throw new Error(
    `Scratch Cursor runtime did not persist ${text}; Session events=[${sessionEvents.join(',')}]; ACP launch=${cursorLaunchState}; fixture events=[${cursorEventTypes.join(',')}].`,
  )
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
  const configEnvironment = isolatedHostEnvironment(scratch.home, scratch.profileRoot)
  const composedConfig = spawnSync(
    'dsh',
    ['--profile', profileName, '--dump-config', '--patch', cursorOverlayPath],
    { encoding: 'utf8', env: configEnvironment },
  )
  if (composedConfig.status !== 0) throw new Error(`Scratch profile composition failed with exit code ${String(composedConfig.status)}.`)
  assert.ok(
    composedConfig.stdout.includes('Scratch ACP fixture'),
    `Scratch profile composition omitted the synthetic Cursor instance (bundle=${composedConfig.stdout.includes('@dshfiles/cursor-agent')}, id=${composedConfig.stdout.includes('dshfiles-cursor-agent')}, fixture=${composedConfig.stdout.includes('Scratch ACP fixture')}).`,
  )
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
  const cursorSession = await platform.sessions.create({
    cwd: cursorProjectRoot,
    runtimeBinding: { driverKind: 'cursor-acp', instanceId: cursorInstanceId },
  })
  await platform.sessions.prompt(cursorSession.sessionId, 'synthetic first provider turn', 'queue')
  await waitForHistoryText(platform, cursorSession.sessionId, 'cursor-fixture-response-1')

  await stopHost()

  const restartedPlatform = await startHost()
  const restartedSessions = await restartedPlatform.sessions.list()
  assert.ok(
    restartedSessions.some(session => session.sessionId === created.sessionId),
    'Session was missing after Host restart.',
  )
  const restartedHistory = await restartedPlatform.sessions.history(created.sessionId)
  assert.deepEqual(restartedHistory.records, initialHistory.records, 'Session history changed across Host restart.')
  await restartedPlatform.sessions.prompt(cursorSession.sessionId, 'synthetic resumed provider turn', 'queue')
  await waitForHistoryText(restartedPlatform, cursorSession.sessionId, 'cursor-fixture-response-2')
  const cursorEvents = (await readFile(cursorEventsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.equal(cursorEvents.filter(event => event.type === 'new').length, 1, 'Cursor runtime did not create exactly one ACP session.')
  assert.equal(cursorEvents.filter(event => event.type === 'load').length, 1, 'Cursor runtime did not resume its ACP session after Host restart.')
  assert.equal(cursorEvents.filter(event => event.type === 'prompt').length, 2, 'Cursor runtime did not complete both synthetic turns.')
  process.stdout.write(`PASS: local Agent and Cursor runtime loaded; Host restart resumed the same ACP session; native Session retained ${restartedHistory.records.length} public history records.\n`)
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
