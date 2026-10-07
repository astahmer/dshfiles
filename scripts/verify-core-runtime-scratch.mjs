import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { access, chmod, cp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
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
const apiSessionControllerPath =
  process.env.DSHX_SCRATCH_API_SESSION_CONTROLLER_PATH === undefined
    ? resolve(coreRoot, 'api-session-controller')
    : resolve(repoRoot, process.env.DSHX_SCRATCH_API_SESSION_CONTROLLER_PATH)
const cursorInstanceId = 'scratch-fixture'
const cursorCredential = 'scratch-only-cursor-fixture'
const corePackages = [
  'api-session-controller',
  'agent',
  'agent-loop',
  'session',
  'session-persistence',
  'session-persistence-jsonl',
  'session-format-catalog',
  'session-format-v4-to-v5',
]
const extraDependencies = {
  '@dshfiles/dsh-core-runtime': `link:${bridgePath}`,
  '@dshfiles/cursor-agent': `link:${cursorPluginPath}`,
  ...Object.fromEntries(
    corePackages.map(name => [`@deepseek-ai/dsh-${name}`, `link:${name === 'api-session-controller' ? apiSessionControllerPath : resolve(coreRoot, name)}`]),
  ),
}

const scratch = await createScratchProfile({
  profileName,
  sourceProfileRoot: resolve(homedir(), '.dsh/profiles/web'),
  bundleIds: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dshfiles/dsh-core-runtime', '@dshfiles/cursor-agent'],
  excludedDependencyPrefixes: ['@dshfiles/', '@mars-sea/', 'dshmarket'],
  extraDependencies,
})

const installProfileLocalApiSessionController = async () => {
  const packageEntryPath = resolve(apiSessionControllerPath, 'lib/index.js')
  await access(packageEntryPath).catch(() => {
    throw new Error(
      `Generated API Session Controller output is required for public CLI acceptance; set DSHX_SCRATCH_API_SESSION_CONTROLLER_PATH to a package containing lib/index.js.`,
    )
  })
  const profilePackagePath = resolve(scratch.profileRoot, 'node_modules/@deepseek-ai/dsh-api-session-controller')
  await rm(profilePackagePath, { force: true, recursive: true })
  await cp(apiSessionControllerPath, profilePackagePath, { recursive: true })
}

const cursorExecutableDirectory = resolve(scratch.home, 'bin')
const cursorExecutablePath = resolve(cursorExecutableDirectory, 'agent')
const cursorLauncherPath = resolve(scratch.home, 'cursor-acp-launcher.mjs')
const cursorLaunchMarkerPath = resolve(scratch.home, 'cursor-acp-launcher-state')
const cursorFixturePath = resolve(repoRoot, 'plugins/@dshfiles/cursor-agent/tests/fixtures/fake-cursor-acp.mjs')
const cursorOverlayPath = resolve(scratch.home, 'cursor-runtime.patch.yml')
const cursorProjectRoot = resolve(scratch.home, 'cursor-project')
const cursorEventsPath = resolve(scratch.home, 'runtime-drivers', 'cursor-acp', cursorInstanceId, 'fixture-events.jsonl')
const cursorResponseGatePath = resolve(dirname(cursorEventsPath), 'hold-prompt-response')
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
    detached: process.platform !== 'win32',
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
    output = `${output}${chunk.toString('utf8')}`.slice(-512_000)
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
    const events = history.records.map(record => record.event ?? record)
    const response = events.find(event => event.type === 'assistant/message' && JSON.stringify(event).includes(text))
    const turnEnded = response !== undefined && events.some(event => event.type === 'turn/end' && event.data.turn === response.data.turn)
    if (turnEnded) return history
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
    const safeMessage = redactHostOutput(message)
      .replaceAll(cursorCredential, '[scratch-credential]')
      .replaceAll('synthetic', '[scratch]')
      .replaceAll('\n', ' ')
      .slice(0, 180)
    return `${type}:error:${reason.error?.code ?? 'UNKNOWN'}:${failure}:${safeMessage}`
  })
  const cursorEventTypes = await readFile(cursorEventsPath, 'utf8')
    .then(contents =>
      contents
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line).type),
    )
    .catch(() => [])
  const cursorLaunchState = await readFile(cursorLaunchMarkerPath, 'utf8').catch(() => 'not-launched')
  throw new Error(
    `Scratch Cursor runtime did not persist ${text}; Session events=[${sessionEvents.join(',')}]; ACP launch=${cursorLaunchState}; fixture events=[${cursorEventTypes.join(',')}].`,
  )
}

const waitForHistoryError = async (platform, sessionId, expectedMessage) => {
  const expiresAt = Date.now() + 15_000
  while (Date.now() < expiresAt) {
    const history = await platform.sessions.history(sessionId)
    const events = history.records.map(record => record.event ?? record)
    const failure = events.find(
      event => event.type === 'turn/end' && event.data.reason?.kind === 'error' && event.data.reason.error?.message?.includes(expectedMessage),
    )
    if (failure !== undefined) return history
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
  }
  throw new Error('Scratch Session did not surface the expected uncertain Cursor outcome.')
}

const commandResultText = (result, description) => {
  const command = typeof result === 'object' && result !== null && 'result' in result ? result.result : result
  if (typeof command !== 'object' || command === null || !('kind' in command) || command.kind !== 'success') {
    throw new Error(`Scratch ${description} command failed: ${JSON.stringify(result)}`)
  }
  return typeof command.text === 'string' ? command.text : ''
}

const readCursorEvents = async () =>
  (await readFile(cursorEventsPath, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))

const waitForCursorEvents = async (accept, description) => {
  const expiresAt = Date.now() + 15_000
  while (Date.now() < expiresAt) {
    const events = await readCursorEvents()
    if (accept(events)) return events
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
  }
  throw new Error(`Scratch Cursor fixture did not produce ${description} within 15 seconds.`)
}

const signalHostTree = (child, signal) => (process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal))

const verifyPublicCliBoot = async () => {
  const environment = isolatedHostEnvironment(scratch.home, scratch.profileRoot)
  const controllerImport = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', "await import('@deepseek-ai/dsh-api-session-controller')"],
    { cwd: scratch.profileRoot, env: environment, encoding: 'utf8', timeout: 10_000 },
  )
  if (controllerImport.status !== 0) {
    const detail = [controllerImport.stderr, controllerImport.stdout, controllerImport.error?.message]
      .filter(value => typeof value === 'string' && value.trim() !== '')
      .join('\n')
      .slice(-4_000)
    process.stdout.write(
      `Session Controller package import probe failed (exit ${String(controllerImport.status)}):\n${redactHostOutput(detail)}\n`,
    )
  }
  let output = ''
  const child = spawn('dsh', [profileName, '--patch', cursorOverlayPath, '--port', '0', '--no-open'], {
    cwd: repoRoot,
    detached: process.platform !== 'win32',
    env: {
      ...environment,
      CURSOR_API_KEY: cursorCredential,
      PATH: [cursorExecutableDirectory, environment.PATH].filter(Boolean).join(delimiter),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = new Promise(resolveExit => child.once('close', (code, signal) => resolveExit({ code, signal })))
  const collect = chunk => {
    output = `${output}${chunk.toString('utf8')}`.slice(-64_000)
  }
  const ready = new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => {
      rejectReady(new Error(`Public DSH CLI did not print its ready URL within 45 seconds.\n${redactHostOutput(output.slice(-4_000))}`))
    }, 45_000)
    const inspect = () => {
      if (/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/.test(output)) {
        clearTimeout(timeout)
        resolveReady()
      }
    }
    child.stdout.on('data', chunk => {
      collect(chunk)
      inspect()
    })
    child.stderr.on('data', chunk => {
      collect(chunk)
      inspect()
    })
    child.once('error', error => {
      clearTimeout(timeout)
      rejectReady(new Error(`Public DSH CLI could not start: ${error.name}.`))
    })
    child.once('close', (code, signal) => {
      if (!/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/.test(output)) {
        clearTimeout(timeout)
        rejectReady(new Error(`Public DSH CLI exited before ready: code=${String(code)}, signal=${String(signal)}.\n${redactHostOutput(output.slice(-4_000))}`))
      }
    })
  })

  try {
    await Promise.race([
      ready,
      exited.then(({ code, signal }) => {
        throw new Error(`Public DSH CLI exited before ready: code=${String(code)}, signal=${String(signal)}.\n${redactHostOutput(output.slice(-4_000))}`)
      }),
    ])
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500))
    assert.ok(!output.includes('agents.registerRuntimeDriver is not a function'), redactHostOutput(output.slice(-8_000)))
    const activationFailures = output.split('\n').filter(line => /failed to import|did not activate|pending \(waiting for service:/i.test(line))
    const bridgeFailures = activationFailures.filter(line => /dshfiles-core-runtime|cursor-agent/i.test(line))
    assert.deepEqual(bridgeFailures, [], redactHostOutput(bridgeFailures.join('\n')))
    const unrelatedFailures = activationFailures.filter(line => !/dshfiles-core-runtime|cursor-agent/i.test(line))
    process.stdout.write('PASS: public dsh CLI booted the local core runtime and Cursor adapter without a provider request.\n')
    if (unrelatedFailures.length > 0) {
      process.stdout.write(`PUBLIC CLI activation blockers: ${redactHostOutput(unrelatedFailures.join('\n'))}\n`)
      const outputLines = output.split('\n')
      const controllerFailureIndex = outputLines.findIndex(line => /session-controller.*failed to import/i.test(line))
      if (controllerFailureIndex >= 0) {
        const controllerFailureContext = outputLines
          .slice(Math.max(0, controllerFailureIndex - 3), Math.min(outputLines.length, controllerFailureIndex + 12))
          .filter(line => !/http:\/\/127\.0\.0\.1:\d+\/\?token=/i.test(line))
          .join('\n')
        process.stdout.write(
          `Session Controller import context:\n${redactHostOutput(controllerFailureContext).replaceAll(cursorCredential, '[redacted]')}\n`,
        )
      }
      const errorIndexes = outputLines.flatMap((line, index) =>
        /\b(?:Error|Exception|ERR_[A-Z_]+|Cannot find (?:module|package))\b/i.test(line) ? [index] : [],
      )
      const errorContext = errorIndexes.flatMap(index =>
        outputLines.slice(Math.max(0, index - 1), Math.min(outputLines.length, index + 6)),
      )
      if (errorContext.length > 0) {
        const sanitizedErrorContext = [...new Set(errorContext)]
          .filter(line => !/http:\/\/127\.0\.0\.1:\d+\/\?token=/i.test(line))
          .slice(-40)
          .join('\n')
        process.stdout.write(`CLI startup error details:\n${redactHostOutput(sanitizedErrorContext).replaceAll(cursorCredential, '[redacted]')}\n`)
      }
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) signalHostTree(child, 'SIGTERM')
    const exit = await Promise.race([exited, new Promise(resolveTimeout => setTimeout(() => resolveTimeout(undefined), 8_000))])
    if (exit === undefined && child.exitCode === null && child.signalCode === null) signalHostTree(child, 'SIGKILL')
    if (exit === undefined) await exited
  }
}

const stopHost = async () => {
  const child = host
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
  signalHostTree(child, 'SIGTERM')
  let timeout
  try {
    await Promise.race([
      hostExited,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Owned scratch Host did not stop within 5 seconds.')), 5_000)
      }),
    ])
  } catch (error) {
    signalHostTree(child, 'SIGKILL')
    await hostExited
    throw error
  } finally {
    clearTimeout(timeout)
  }
  host = undefined
}

const crashHost = async () => {
  const child = host
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) {
    throw new Error('No active owned scratch Host is available for the crash-recovery check.')
  }
  assert.equal(signalHostTree(child, 'SIGKILL'), true, 'Could not terminate the owned scratch Host process tree.')
  const exit = await hostExited
  assert.equal(exit.signal, 'SIGKILL', 'Scratch Host did not exit from the requested unclean termination.')
  host = undefined
}

try {
  await scratch.install()
  await installProfileLocalApiSessionController()
  const configEnvironment = isolatedHostEnvironment(scratch.home, scratch.profileRoot)
  const composedConfig = spawnSync('dsh', ['--profile', profileName, '--dump-config', '--patch', cursorOverlayPath], {
    encoding: 'utf8',
    env: configEnvironment,
  })
  if (composedConfig.status !== 0) throw new Error(`Scratch profile composition failed with exit code ${String(composedConfig.status)}.`)
  assert.ok(
    composedConfig.stdout.includes('Scratch ACP fixture'),
    `Scratch profile composition omitted the synthetic Cursor instance (bundle=${composedConfig.stdout.includes('@dshfiles/cursor-agent')}, id=${composedConfig.stdout.includes('dshfiles-cursor-agent')}, fixture=${composedConfig.stdout.includes('Scratch ACP fixture')}).`,
  )
  assert.ok(composedConfig.stdout.includes('dshfiles-core-runtime'), 'Scratch composition omitted the local core runtime Host row.')
  await verifyPublicCliBoot()
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
  const initialCursorHistory = await waitForHistoryText(platform, cursorSession.sessionId, 'cursor-fixture-response-1')

  await stopHost()
  const cleanRestartedPlatform = await startHost()
  const cleanRestartedSessions = await cleanRestartedPlatform.sessions.list()
  assert.ok(
    cleanRestartedSessions.some(session => session.sessionId === cursorSession.sessionId),
    'Cursor-bound Session was missing after a clean Host restart.',
  )
  const cleanRestartedCursorHistory = await cleanRestartedPlatform.sessions.history(cursorSession.sessionId)
  assert.deepEqual(
    cleanRestartedCursorHistory.records,
    initialCursorHistory.records,
    'Cursor Session history changed across a clean Host restart.',
  )
  await cleanRestartedPlatform.sessions.prompt(cursorSession.sessionId, 'synthetic resumed provider turn', 'queue')
  await waitForHistoryText(cleanRestartedPlatform, cursorSession.sessionId, 'cursor-fixture-response-2')
  const cleanRestartEvents = await waitForCursorEvents(
    events => events.filter(event => event.type === 'prompt').length === 2 && events.filter(event => event.type === 'response').length === 2,
    'the resumed Cursor provider turn after a clean Host restart',
  )
  assert.equal(cleanRestartEvents.filter(event => event.type === 'new').length, 1, 'Clean restart created a replacement Cursor ACP session.')
  assert.equal(cleanRestartEvents.filter(event => event.type === 'load').length, 1, 'Clean restart did not load the existing Cursor ACP session.')
  assert.equal(cleanRestartEvents.filter(event => event.type === 'prompt').length, 2, 'Clean restart did not submit exactly two Cursor prompts.')
  assert.equal(cleanRestartEvents.filter(event => event.type === 'response').length, 2, 'Clean restart did not complete exactly two Cursor responses.')

  await writeFile(cursorResponseGatePath, 'hold response until the verifier crashes the scratch Host\n')
  await cleanRestartedPlatform.sessions.prompt(cursorSession.sessionId, 'synthetic interrupted provider turn', 'queue')
  const inFlightCursorEvents = await waitForCursorEvents(
    events => events.filter(event => event.type === 'prompt').length === 3 && events.filter(event => event.type === 'response').length === 2,
    'the second in-flight provider prompt',
  )
  await crashHost()
  assert.equal(inFlightCursorEvents.filter(event => event.type === 'prompt').length, 3)
  await unlink(cursorResponseGatePath)
  await waitForCursorEvents(
    events => events.some(event => event.type === 'response-notification-failed:closed'),
    'the interrupted ACP process to report its lost Host connection',
  )

  const restartedPlatform = await startHost()
  const restartedSessions = await restartedPlatform.sessions.list()
  assert.ok(
    restartedSessions.some(session => session.sessionId === created.sessionId),
    'Session was missing after Host restart.',
  )
  assert.ok(
    restartedSessions.some(session => session.sessionId === cursorSession.sessionId),
    'Cursor-bound Session was missing after the unclean Host termination.',
  )
  const recoveredCursorSummary = restartedSessions.find(session => session.sessionId === cursorSession.sessionId)
  assert.ok(recoveredCursorSummary, 'Cursor-bound Session summary was missing after the unclean Host termination.')
  const restartedHistory = await restartedPlatform.sessions.history(created.sessionId)
  assert.deepEqual(restartedHistory.records, initialHistory.records, 'Session history changed across Host restart.')
  const recoveredCursorHistory = await restartedPlatform.sessions.history(cursorSession.sessionId)
  const recoveredCursorText = JSON.stringify(recoveredCursorHistory.records)
  const recoveredCursorEvents = recoveredCursorHistory.records.map(record => record.event ?? record)
  assert.ok(
    recoveredCursorHistory.records.length >= initialCursorHistory.records.length,
    'Cursor-bound Session history lost records after the unclean Host termination.',
  )
  assert.ok(recoveredCursorText.includes('synthetic interrupted provider turn'), 'The interrupted user prompt was not recovered.')
  assert.ok(!recoveredCursorText.includes('cursor-fixture-response-3'), 'The unresolved provider operation was reported as completed.')
  assert.ok(
    recoveredCursorEvents.some(event => event.type === 'turn/end' && event.data.reason?.kind === 'interrupted'),
    'The in-flight turn was not marked interrupted after Host recovery.',
  )
  const recoveredPromptSeqs = recoveredCursorEvents.filter(event => event.type === 'user/message' && event.data.source.kind === 'user').map(event => event.seq)
  assert.ok(recoveredPromptSeqs.length > 0, 'No user prompt sequence was recovered after Host termination.')
  assert.deepEqual(
    recoveredCursorSummary.attention,
    {
      lastPromptSeq: Math.max(...recoveredPromptSeqs),
      readThroughSeq: -1,
      snoozed: false,
      unread: true,
    },
    'Session attention did not recover the unread prompt watermark after Host termination.',
  )
  await restartedPlatform.sessions.prompt(cursorSession.sessionId, 'synthetic provider turn after crash recovery', 'queue')
  const recoveredTurnHistory = await waitForHistoryError(
    restartedPlatform,
    cursorSession.sessionId,
    'Cursor prompt outcome is uncertain; refusing to replay possible workspace changes.',
  )
  const recoveredTurnEvents = recoveredTurnHistory.records.map(record => record.event ?? record)
  assert.equal(
    recoveredTurnEvents.filter(event => event.type === 'turn/start').length,
    recoveredTurnEvents.filter(event => event.type === 'turn/end').length,
    'A turn remained unclosed after the interrupted Session resumed.',
  )
  assert.ok(
    recoveredTurnEvents.some(
      event =>
        event.type === 'turn/end' && event.data.reason?.kind === 'error' && event.data.reason.error?.message?.includes('Cursor prompt outcome is uncertain'),
    ),
    'The unresolved Cursor provider outcome was not surfaced to the Session.',
  )
  const recoveredTurnText = JSON.stringify(recoveredTurnHistory.records)
  assert.ok(!recoveredTurnText.includes('cursor-fixture-response-3'), 'The Host replayed the unresolved provider operation after recovery.')
  assert.ok(recoveredTurnText.includes('synthetic provider turn after crash recovery'), 'The rejected post-crash prompt was not retained in Session history.')
  const cursorEventsBeforeReconcile = await readCursorEvents()
  assert.equal(cursorEventsBeforeReconcile.filter(event => event.type === 'new').length, 1, 'Cursor runtime did not create exactly one ACP session.')
  assert.equal(
    cursorEventsBeforeReconcile.filter(event => event.type === 'process-start').length,
    inFlightCursorEvents.filter(event => event.type === 'process-start').length,
    'Cursor runtime launched a new provider process after the Host crash.',
  )
  assert.equal(
    cursorEventsBeforeReconcile.filter(event => event.type === 'load').length,
    inFlightCursorEvents.filter(event => event.type === 'load').length,
    'Cursor runtime loaded the uncertain provider session after the Host crash.',
  )
  assert.equal(
    cursorEventsBeforeReconcile.filter(event => event.type === 'prompt').length,
    inFlightCursorEvents.filter(event => event.type === 'prompt').length,
    'Cursor runtime replayed an uncertain prompt or launched a rejected post-crash prompt.',
  )
  assert.equal(
    cursorEventsBeforeReconcile.filter(event => event.type === 'response').length,
    inFlightCursorEvents.filter(event => event.type === 'response').length,
    'Cursor runtime exposed a response for the interrupted provider call.',
  )
  assert.equal(
    cursorEventsBeforeReconcile.filter(event => event.type === 'response-notification-failed:closed').length,
    1,
    'The interrupted ACP process did not confirm its response was detached from the crashed Host.',
  )

  const recoverySession = await restartedPlatform.sessions.create({ cwd: repoRoot })
  const recoveryCommands = await restartedPlatform.commands.list(recoverySession.sessionId)
  assert.ok(
    recoveryCommands.some(command => command.name === 'cursor-reconcile'),
    'The recovery command was not registered on the working Session.',
  )
  const statusResult = await restartedPlatform.commands.execute(recoverySession.sessionId, `/cursor-reconcile status ${cursorSession.sessionId}`)
  const statusText = commandResultText(statusResult, 'status')
  const operationId = statusText.match(/receipt ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1]
  assert.ok(operationId, `Status did not return a pending Cursor operation receipt: ${statusText}`)
  const confirmationResult = await restartedPlatform.commands.execute(
    recoverySession.sessionId,
    `/cursor-reconcile confirm ${cursorSession.sessionId} ${operationId} verified`,
  )
  const confirmationText = commandResultText(confirmationResult, 'confirmation')
  assert.ok(confirmationText.includes('durably recorded in the invoking Session'), 'Confirmation did not report its durable source Session.')
  const clearedStatus = await restartedPlatform.commands.execute(recoverySession.sessionId, `/cursor-reconcile status ${cursorSession.sessionId}`)
  assert.ok(
    commandResultText(clearedStatus, 'post-confirm status').includes('No unsettled Cursor runtime receipt'),
    'Confirmation did not clear the exact target receipt.',
  )

  const confirmationHistory = await restartedPlatform.sessions.history(recoverySession.sessionId)
  const confirmationEvents = confirmationHistory.records.map(record => record.event ?? record)
  assert.ok(
    confirmationEvents.some(event => event.type === 'command/run' && JSON.stringify(event).includes(operationId)),
    'The invoking Session did not durably record the exact human confirmation command.',
  )
  const cursorEventsAfterReconcile = await readCursorEvents()
  assert.equal(
    cursorEventsAfterReconcile.filter(event => event.type === 'process-start').length,
    cursorEventsBeforeReconcile.filter(event => event.type === 'process-start').length,
    'Reconciliation started a Cursor process.',
  )
  assert.equal(
    cursorEventsAfterReconcile.filter(event => event.type === 'load').length,
    cursorEventsBeforeReconcile.filter(event => event.type === 'load').length,
    'Reconciliation loaded the provider session.',
  )
  assert.equal(
    cursorEventsAfterReconcile.filter(event => event.type === 'prompt').length,
    cursorEventsBeforeReconcile.filter(event => event.type === 'prompt').length,
    'Reconciliation replayed or submitted a provider prompt.',
  )

  await stopHost()
  const durablePlatform = await startHost()
  const durableConfirmationHistory = await durablePlatform.sessions.history(recoverySession.sessionId)
  const durableConfirmationEvents = durableConfirmationHistory.records.map(record => record.event ?? record)
  assert.ok(
    durableConfirmationEvents.some(event => event.type === 'command/run' && JSON.stringify(event).includes(operationId)),
    'The invoking Session confirmation did not survive a Host restart.',
  )
  await durablePlatform.sessions.prompt(cursorSession.sessionId, 'synthetic provider turn after explicit reconciliation', 'queue')
  const postReconcileHistory = await waitForHistoryText(durablePlatform, cursorSession.sessionId, 'cursor-fixture-response-4')
  assert.ok(
    JSON.stringify(postReconcileHistory.records).includes('synthetic provider turn after explicit reconciliation'),
    'The post-reconciliation prompt was not retained in the recovered Session.',
  )
  assert.ok(
    !JSON.stringify(postReconcileHistory.records).includes('cursor-fixture-response-3'),
    'The previously uncertain provider response was replayed into Session history.',
  )

  const cursorEventsAfterResume = await readCursorEvents()
  assert.equal(
    cursorEventsAfterResume.filter(event => event.type === 'new').length,
    1,
    'Recovery created a replacement Cursor ACP session instead of reusing the original.',
  )
  assert.equal(
    cursorEventsAfterResume.filter(event => event.type === 'load').length,
    cursorEventsBeforeReconcile.filter(event => event.type === 'load').length + 1,
    'Recovery did not resume the original Cursor ACP session exactly once.',
  )
  assert.equal(
    cursorEventsAfterResume.filter(event => event.type === 'prompt').length,
    cursorEventsBeforeReconcile.filter(event => event.type === 'prompt').length + 1,
    'Recovery replayed the uncertain prompt instead of submitting only the new prompt.',
  )
  assert.equal(
    cursorEventsAfterResume.filter(event => event.type === 'response').length,
    cursorEventsBeforeReconcile.filter(event => event.type === 'response').length + 1,
    'The post-reconciliation Cursor prompt did not produce exactly one response.',
  )
  process.stdout.write(
    `PASS: SIGKILL recovered ${recoveredTurnHistory.records.length} public Session records and unread attention, refused uncertain work without replay, durably recorded human reconciliation from a separate Session, cleared the exact receipt across restart, and resumed the same Cursor ACP session for one new prompt.\n`,
  )
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
