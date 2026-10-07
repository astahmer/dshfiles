import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir, tmpdir } from 'node:os'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
if (process.versions.node !== '22.23.3') {
  throw new Error(`Use Node 22.23.3 for DSH acceptance; found ${process.versions.node}.`)
}

const pnpmVersion = spawnSync('pnpm', ['--version'], { encoding: 'utf8' })
if (pnpmVersion.status !== 0 || pnpmVersion.stdout.trim() !== '12.5.1') {
  throw new Error(`Use pnpm 12.5.1 for DSH acceptance; found ${pnpmVersion.stdout.trim() || 'unavailable'}.`)
}

const dshOutput = spawnSync('dsh', ['--version'], { encoding: 'utf8' })
if (dshOutput.status !== 0 || dshOutput.stdout.trim() !== '0.2.0-rc.2') {
  throw new Error(`Scratch acceptance requires DSH 0.2.0-rc.2; found ${dshOutput.stdout.trim() || 'unavailable'}.`)
}

const helperPath = resolve(repoRoot, 'tooling/dshx/packages/dshx/dist/project/scratch-profile.js')
const { createScratchProfile, isolatedHostEnvironment, redactHostOutput } = await import(pathToFileURL(helperPath).href)
const packagePath = resolve(repoRoot, 'plugins/@dshfiles/ai-accounts')
const probeTemporaryRoot = await mkdtemp(join(tmpdir(), 'ai-accounts-scheduler-probe-'))
const probePackagePath = join(probeTemporaryRoot, '@dshfiles', 'ai-accounts-scheduler-probe')
const probeResultPath = join(probeTemporaryRoot, 'scheduler-probe-result.json')
await mkdir(dirname(probePackagePath), { recursive: true })
await cp(resolve(packagePath, 'tests/fixtures/scheduler-probe'), probePackagePath, { recursive: true })
const profileName = 'ai-accounts-quota'
let scratch
try {
  scratch = await createScratchProfile({
    profileName,
    sourceProfileRoot: resolve(homedir(), '.dsh/profiles/web'),
    bundleIds: [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@deepseek-ai/dsh-experimental-schedule-bundle',
      '@dshfiles/ai-accounts',
      '@dshfiles/ai-accounts-scheduler-probe',
    ],
    excludedDependencyPrefixes: ['@dshfiles/', '@mars-sea/', 'dshmarket'],
    extraDependencies: {
      '@deepseek-ai/dsh-experimental-schedule-bundle': '0.2.0-rc.2',
      '@deepseek-ai/dsh-schedule': '0.2.0-rc.2',
      '@dshfiles/ai-accounts': `link:${packagePath}`,
      '@dshfiles/ai-accounts-scheduler-probe': `link:${probePackagePath}`,
    },
  })
} catch (error) {
  await rm(probeTemporaryRoot, { recursive: true, force: true })
  throw error
}

let host
let hostExited
let output = ''

const startHost = async () => {
  const environment = isolatedHostEnvironment(scratch.home, scratch.profileRoot)
  const child = spawn('dsh', ['--profile', profileName, '--port', '0', '--no-open'], {
    cwd: repoRoot,
    env: { ...environment, DSHX_SCHEDULE_PROBE_RESULT: probeResultPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  host = child
  hostExited = new Promise(resolveExit => child.once('close', (code, signal) => resolveExit({ code, signal })))
  const collect = chunk => {
    output = `${output}${chunk.toString('utf8')}`.slice(-32_000)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)

  await Promise.race([
    new Promise((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => {
        rejectReady(new Error(`Scratch Host did not print its tokenized URL within 45 seconds.\n${redactHostOutput(output.slice(-4_000))}`))
      }, 45_000)
      const inspect = () => {
        if (/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/.test(output)) {
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
        if (!/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/.test(output)) {
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
  assert.equal(child.exitCode, null, 'Scratch Host exited after printing its tokenized URL.')
  const activationFailures = output.split('\n').filter(line => /failed to import|did not activate|pending \(waiting for service:/i.test(line))
  assert.deepEqual(activationFailures, [], redactHostOutput(output.slice(-6_000)))
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

const waitForScheduleDelivery = async () => {
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    const resultText = await readFile(probeResultPath, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (resultText !== undefined) {
      const result = JSON.parse(resultText)
      assert.equal(result.status, 'delivered', `Schedule probe failed: ${result.errorName ?? 'unknown error'}.`)
      assert.ok(result.sessionId, 'Schedule probe omitted its original Session identity.')
      assert.ok(result.scheduleId, 'Schedule probe omitted its durable task identity.')
      assert.ok(result.messageId, 'Schedule probe omitted the delivery receipt identity.')
      assert.ok(Number.isSafeInteger(result.messageSeq), 'Schedule probe omitted the delivered Session sequence.')
      return result
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
  }
  throw new Error('Scratch Schedule Host did not persist a delivery receipt within 25 seconds.')
}

try {
  await scratch.install()
  const environment = isolatedHostEnvironment(scratch.home, scratch.profileRoot)
  const dump = spawnSync('dsh', ['--profile', profileName, '--dump-config'], {
    cwd: repoRoot,
    env: environment,
    encoding: 'utf8',
  })
  assert.equal(dump.status, 0, `Scratch profile composition failed.\n${redactHostOutput(dump.stderr)}`)
  assert.ok(dump.stdout.includes('@dshfiles/ai-accounts'), 'Scratch composition omitted the AI Accounts bundle.')
  assert.ok(dump.stdout.includes('@deepseek-ai/dsh-schedule'), 'Scratch composition omitted the DSH Scheduler service row.')
  assert.ok(dump.stdout.includes('@dshfiles/ai-accounts-scheduler-probe'), 'Scratch composition omitted its test-only Scheduler probe.')
  await startHost()
  const delivery = await waitForScheduleDelivery()
  process.stdout.write(`PASS: DSH Schedule delivered to scratch Session ${delivery.sessionId} and persisted receipt ${delivery.messageId}.\n`)
} finally {
  try {
    await stopHost()
  } finally {
    try {
      await scratch.cleanup()
    } finally {
      await rm(probeTemporaryRoot, { recursive: true, force: true })
    }
  }
}
