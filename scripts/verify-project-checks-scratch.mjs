import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
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
const platformPath = resolve(repoRoot, 'tooling/dshx/packages/dshx/dist/platform/index.js')
const apiRuntimePath = resolve(repoRoot, 'tooling/dshx/packages/dshx/dist/api/runtime.js')
const projectChecksPath = resolve(repoRoot, 'plugins/@dshfiles/project-checks')
const projectChecksApiPath = resolve(projectChecksPath, 'src/api.ts')
const packageRequire = createRequire(resolve(projectChecksPath, 'package.json'))
const { z } = packageRequire('zod')
const { createScratchProfile, isolatedHostEnvironment, redactHostOutput } = await import(pathToFileURL(helperPath).href)
const { connectDshPlatformClient } = await import(pathToFileURL(platformPath).href)
const { createApiClient } = await import(pathToFileURL(apiRuntimePath).href)
const { projectChecksApi } = await import(pathToFileURL(projectChecksApiPath).href)

const profileName = 'project-checks'
const cursorPluginPath = resolve(repoRoot, 'plugins/@dshfiles/cursor-agent')
const coreRoot = resolve(repoRoot, 'tooling/dsh-core')
const hooksCodexPath = resolve(repoRoot, 'plugins/node_modules/@deepseek-ai/dsh-hooks-codex')
const cursorInstanceId = 'scratch-fixture'
const cursorCredential = 'scratch-only-cursor-fixture'
const corePackages = ['api-session-controller', 'agent', 'agent-loop', 'session', 'session-persistence', 'session-persistence-jsonl', 'session-format-catalog', 'session-format-v4-to-v5']
const extraDependencies = {
  '@dshfiles/project-checks': `link:${projectChecksPath}`,
  '@dshfiles/dsh-core-runtime': `link:${resolve(repoRoot, 'plugins/@dshfiles/dsh-core-runtime')}`,
  '@dshfiles/cursor-agent': `link:${cursorPluginPath}`,
  '@deepseek-ai/dsh-hooks-codex': `link:${hooksCodexPath}`,
  ...Object.fromEntries(corePackages.map(name => [`@deepseek-ai/dsh-${name}`, `link:${resolve(coreRoot, name)}`])),
}

const scratch = await createScratchProfile({
  profileName,
  sourceProfileRoot: resolve(homedir(), '.dsh/profiles/web'),
  bundleIds: [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    '@deepseek-ai/dsh-hooks-codex',
    '@dshfiles/dsh-core-runtime',
    '@dshfiles/cursor-agent',
    '@dshfiles/project-checks',
  ],
  excludedDependencyPrefixes: ['@dshfiles/', '@mars-sea/', 'dshmarket'],
  extraDependencies,
})

const projectRoot = resolve(scratch.home, 'project')
const cursorExecutableDirectory = resolve(scratch.home, 'bin')
const cursorExecutablePath = resolve(cursorExecutableDirectory, 'agent')
const cursorLauncherPath = resolve(scratch.home, 'cursor-acp-launcher.mjs')
const cursorLaunchMarkerPath = resolve(scratch.home, 'cursor-acp-launcher-state')
const cursorFixturePath = resolve(repoRoot, 'plugins/@dshfiles/cursor-agent/tests/fixtures/fake-cursor-acp.mjs')
const cursorOverlayPath = resolve(scratch.home, 'project-checks.patch.yml')
const hookConfigPath = resolve(scratch.home, 'codex-hooks.json')
const hookScriptPath = resolve(scratch.home, 'project-check-hook.mjs')
const hookMarkerPath = resolve(scratch.home, 'project-check-hook-runs')
const cursorEventsPath = resolve(scratch.home, 'runtime-drivers', 'cursor-acp', cursorInstanceId, 'fixture-events.jsonl')
let projectRootReal
let host
let hostExited

const initializeScratchProject = async () => {
  await mkdir(projectRoot, { recursive: true })
  projectRootReal = await realpath(projectRoot)
  const initialization = spawnSync('jj', ['git', 'init', '--no-colocate', projectRootReal], { encoding: 'utf8', cwd: scratch.home })
  if (initialization.status !== 0) throw new Error(`Could not initialize the scratch JJ project: ${redactHostOutput(initialization.stderr).slice(-1_000)}`)
  for (const [name, value] of [
    ['user.name', '"Project Checks Scratch"'],
    ['user.email', '"project-checks@example.invalid"'],
  ]) {
    const configured = spawnSync('jj', ['config', 'set', '--repo', name, value], { encoding: 'utf8', cwd: projectRootReal })
    if (configured.status !== 0) throw new Error(`Could not configure the scratch JJ project field ${name}.`)
  }
  await writeFile(resolve(projectRootReal, 'seed.txt'), 'scratch source revision\n')
  const snapshot = spawnSync('jj', ['status'], { encoding: 'utf8', cwd: projectRootReal })
  if (snapshot.status !== 0) throw new Error(`Could not snapshot the scratch JJ project: ${redactHostOutput(snapshot.stderr).slice(-1_000)}`)
}

const writeScratchConfiguration = async () => {
  await mkdir(cursorExecutableDirectory, { recursive: true })
  await writeFile(
    cursorLauncherPath,
    `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(cursorLaunchMarkerPath)}, 'started')\ntry {\n  await import(${JSON.stringify(pathToFileURL(cursorFixturePath).href)})\n} catch (error) {\n  const message = error instanceof Error ? error.message : ''\n  const failure = message.includes('Scratch Cursor fixture requires') ? 'invalid-fixture-environment' : message.includes('only supports ACP mode') ? 'wrong-acp-argument' : 'fixture-import-failed'\n  writeFileSync(${JSON.stringify(cursorLaunchMarkerPath)}, 'failed:' + failure)\n  process.exitCode = 1\n}\n`,
  )
  await writeFile(cursorExecutablePath, `#!/bin/sh\nexec "${process.execPath}" "${cursorLauncherPath}" "$@"\n`, { mode: 0o700 })
  await chmod(cursorExecutablePath, 0o700)
  await writeFile(
    hookScriptPath,
    `import { appendFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(hookMarkerPath)}, 'Stop\\n')\nprocess.stderr.write('scratch hook failed as configured\\n')\nprocess.exitCode = 7\n`,
  )
  await writeFile(
    hookConfigPath,
    `${JSON.stringify(
      {
        hooks: {
          Stop: [
            {
              hooks: [
                { type: 'command', command: `${JSON.stringify(process.execPath)} ${JSON.stringify(hookScriptPath)}` },
                { type: 'prompt', prompt: 'unsupported fixture hook' },
              ],
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    cursorOverlayPath,
    `- insert:\n    - id: hooks-codex\n      name: '@deepseek-ai/dsh-hooks-codex'\n- id: hooks-codex\n  name: '@deepseek-ai/dsh-hooks-codex'\n  config:\n    configPath: ${JSON.stringify(hookConfigPath)}\n    defaultTimeoutMs: 10000\n    stderrSummaryMaxChars: 80\n- id: dshfiles-project-checks\n  name: '@dshfiles/project-checks'\n  config:\n    actions:\n      - id: scratch-check\n        label: Scratch project check\n        description: Verifies revision-bound action receipts.\n        command: ${JSON.stringify(process.execPath)}\n        args:\n          - --version\n        root: ${JSON.stringify(projectRootReal)}\n        timeoutMs: 10000\n        verifyBeforeComplete: true\n    maxVerificationAttempts: 2\n- id: dshfiles-cursor-agent\n  name: '@dshfiles/cursor-agent'\n  config:\n    instances:\n      - id: ${cursorInstanceId}\n        label: Scratch ACP fixture\n        credentialRef: CURSOR_API_KEY\n        credentialKind: api-key\n`,
  )
}

const rpcResponseSchema = z.object({
  type: z.literal('server-response'),
  rpcId: z.string(),
  result: z.union([
    z.object({ ok: z.literal(true), value: z.unknown() }),
    z.object({ ok: z.literal(false), error: z.object({ code: z.string().optional(), message: z.string() }) }),
  ]),
})

const makeProjectChecksClient = (origin, cookie) =>
  createApiClient(
    {
      get: name =>
        name === 'connection'
          ? {
              rpc: {
                call: async (path, method, payload, signal) => {
                  const rpcId = randomUUID()
                  const endpoint = `${path}/${method}`
                  let response
                  try {
                    response = await fetch(new URL(endpoint, origin), {
                      method: 'POST',
                      redirect: 'error',
                      headers: { 'content-type': 'application/json', cookie },
                      body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
                      ...(signal === undefined ? {} : { signal }),
                    })
                  } catch {
                    return { ok: false, error: { code: 'rpc-unreachable', message: 'Scratch Project Checks RPC was unreachable.' } }
                  }
                  if (!response.ok) return { ok: false, error: { code: 'rpc-http-error', message: `Scratch Project Checks RPC returned HTTP ${response.status}.` } }
                  let envelope
                  try {
                    envelope = rpcResponseSchema.safeParse(await response.json())
                  } catch {
                    return { ok: false, error: { code: 'invalid-response', message: 'Scratch Project Checks RPC returned invalid JSON.' } }
                  }
                  if (!envelope.success || envelope.data.rpcId !== rpcId)
                    return { ok: false, error: { code: 'invalid-response', message: 'Scratch Project Checks RPC returned an invalid envelope.' } }
                  const result = envelope.data.result
                  if (result.ok) return result
                  return {
                    ok: false,
                    error: {
                      ...result.error,
                      message: `${method.split('/').at(-1)}: ${result.error.message}`,
                    },
                  }
                },
              },
            }
          : undefined,
    },
    projectChecksApi,
    '@dshfiles/project-checks',
  )

const startHost = async () => {
  let output = ''
  let cookie
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
  const captureFetch = async (input, init) => {
    const response = await fetch(input, init)
    const requestUrl = input instanceof Request ? input.url : String(input)
    if (new URL(requestUrl).searchParams.has('token')) {
      cookie = response.headers
        .getSetCookie()
        .map(item => item.split(';', 1)[0])
        .filter(Boolean)
        .join('; ')
    }
    return response
  }
  const platform = await connectDshPlatformClient({ url: launchUrl, fetch: captureFetch })
  assert.ok(cookie, 'Scratch Host did not issue an authenticated session cookie.')
  process.stdout.write('Scratch Host booted and authenticated without activation failures.\n')
  return { platform, projectChecks: makeProjectChecksClient(new URL(launchUrl).origin, cookie) }
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

const waitFor = async (read, accept, description) => {
  const expiresAt = Date.now() + 20_000
  while (Date.now() < expiresAt) {
    const value = await read()
    if (accept(value)) return value
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
  }
  throw new Error(`Scratch Host did not produce ${description} within 20 seconds.`)
}

try {
  await scratch.install()
  await initializeScratchProject()
  await writeScratchConfiguration()
  const configEnvironment = isolatedHostEnvironment(scratch.home, scratch.profileRoot)
  const composedConfig = spawnSync(
    'dsh',
    ['--profile', profileName, '--dump-config', '--patch', cursorOverlayPath],
    { encoding: 'utf8', env: configEnvironment },
  )
  if (composedConfig.status !== 0)
    throw new Error(`Scratch profile composition failed: ${redactHostOutput(composedConfig.stderr).slice(-2_000)}`)
  for (const label of ['Scratch project check', 'Scratch ACP fixture', 'hooks-codex'])
    assert.ok(composedConfig.stdout.includes(label), `Scratch profile composition omitted ${label}.`)

  const scratchHost = await startHost()
  const session = await scratchHost.platform.sessions.create({
    cwd: projectRootReal,
    runtimeBinding: { driverKind: 'cursor-acp', instanceId: cursorInstanceId },
  })
  let actions
  try {
    actions = await scratchHost.projectChecks.actions({ sessionId: session.sessionId })
  } catch (cause) {
    throw new Error(`Project Checks actions API failed: ${cause instanceof Error ? cause.message : 'unknown failure'}`)
  }
  assert.ok(actions.some(action => action.id === 'scratch-check'), 'Project Checks did not expose the configured action in the scratch JJ project.')

  const initialReceipt = await scratchHost.projectChecks.run({ sessionId: session.sessionId, actionId: 'scratch-check' })
  assert.equal(initialReceipt.status, 'passed', 'Project Checks action did not pass in the scratch JJ project.')
  assert.equal(initialReceipt.freshness, 'current', 'Project Checks did not bind the receipt to the current JJ revision.')
  assert.ok(initialReceipt.sourceRevision, 'Project Checks did not record the scratch JJ source revision.')

  await writeFile(resolve(projectRootReal, 'edited.txt'), 'working-copy revision changed\n')
  const snapshotAfterEdit = spawnSync('jj', ['status'], { encoding: 'utf8', cwd: projectRootReal })
  if (snapshotAfterEdit.status !== 0) throw new Error(`Could not snapshot the edited scratch JJ project: ${redactHostOutput(snapshotAfterEdit.stderr).slice(-1_000)}`)
  const staleReceipts = await scratchHost.projectChecks.receipts({ sessionId: session.sessionId })
  const staleReceipt = staleReceipts.find(receipt => receipt.id === initialReceipt.id)
  assert.equal(staleReceipt?.freshness, 'stale', 'An edited scratch JJ revision did not stale the earlier Project Checks receipt.')

  const refreshedReceipt = await scratchHost.projectChecks.run({ sessionId: session.sessionId, actionId: 'scratch-check' })
  assert.equal(refreshedReceipt.status, 'passed', 'Project Checks action did not pass after the scratch JJ edit.')
  assert.equal(refreshedReceipt.freshness, 'current', 'The refreshed Project Checks receipt is not current.')
  assert.notEqual(refreshedReceipt.sourceRevision, initialReceipt.sourceRevision, 'Project Checks did not record the edited JJ revision.')

  await scratchHost.platform.sessions.prompt(session.sessionId, 'synthetic Project Checks verification turn', 'queue')
  await waitFor(
    () => scratchHost.platform.sessions.history(session.sessionId),
    history => JSON.stringify(history.records).includes('cursor-fixture-response-1'),
    'the synthetic provider response',
  )
  const automaticReceipts = await waitFor(
    () => scratchHost.projectChecks.receipts({ sessionId: session.sessionId }),
    receipts => receipts.some(receipt => receipt.automatic && receipt.status === 'passed'),
    'an automatic Project Checks receipt',
  )
  const automaticReceipt = automaticReceipts.find(receipt => receipt.automatic && receipt.status === 'passed')
  assert.ok(automaticReceipt)
  assert.equal(automaticReceipt.freshness, 'current', 'The automatic Project Checks receipt is not tied to the current JJ revision.')

  const hookEvents = await waitFor(
    () => scratchHost.projectChecks.hookEvents({ sessionId: session.sessionId }),
    events => events.some(event => event.kind === 'result' && event.point === 'Stop'),
    'the native Codex Stop hook result',
  )
  const hookResult = hookEvents.find(event => event.kind === 'result' && event.point === 'Stop')
  assert.ok(hookResult)
  assert.equal(hookResult.dialect, null, 'Result events must not claim an invocation dialect.')
  assert.equal(hookResult.exitCode, 7, 'Project Checks did not expose the failing native hook exit code.')
  assert.equal(hookResult.stderrPresent, true, 'Project Checks did not expose the bounded native hook stderr-presence signal.')
  assert.ok(hookEvents.some(event => event.kind === 'invoked' && event.point === 'Stop' && event.dialect === 'codex'))
  assert.equal(hookEvents.length, 2, 'Project Checks exposed a durable event for a skipped hook that the Host did not record.')
  assert.equal((await readFile(hookMarkerPath, 'utf8')).trim(), 'Stop', 'The configured Codex hook command did not run exactly once.')

  const cursorEvents = (await readFile(cursorEventsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.equal(cursorEvents.filter(event => event.type === 'new').length, 1, 'Scratch Cursor runtime did not create exactly one ACP session.')
  assert.equal(cursorEvents.filter(event => event.type === 'prompt').length, 1, 'Scratch Cursor runtime did not complete exactly one provider prompt.')

  process.stdout.write(
    `PASS: Project Checks action freshness changed current → stale → current across JJ revisions; automatic verification passed; native Codex Stop hook result exposed exit 7 and stderr presence; the unsupported hook emitted no durable event.\n`,
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
