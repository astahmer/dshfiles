import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../')
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
const packagePath = resolve(repoRoot, 'plugins/@dshfiles/agent-questions')
const fixturePath = resolve(repoRoot, 'plugins/@dshfiles/agent-questions/tests/fixtures/agent-questions-cold-resume-fixture')
const profileName = 'agent-questions'
const scratch = await createScratchProfile({
  profileName,
  sourceProfileRoot: resolve(homedir(), '.dsh/profiles/web'),
  bundleIds: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dshfiles/agent-questions', '@dshfiles/agent-questions-cold-resume-fixture'],
  excludedDependencyPrefixes: ['@dshfiles/', '@mars-sea/', 'dshmarket'],
  extraDependencies: {
    '@dshfiles/agent-questions': `link:${packagePath}`,
    '@dshfiles/agent-questions-cold-resume-fixture': `link:${fixturePath}`,
  },
})
const fixtureWorkspacePath = resolve(scratch.home, 'agent-questions-project')
const fixtureStatePath = resolve(scratch.home, 'agent-questions-cold-resume-state.json')
const fixtureResultPath = resolve(scratch.home, 'agent-questions-cold-resume-result.json')

let host
let hostExited
let output = ''

const startHost = async () => {
  output = ''
  const environment = isolatedHostEnvironment(scratch.home, scratch.profileRoot)
  const child = spawn('dsh', ['--profile', profileName, '--port', '0', '--no-open'], {
    cwd: repoRoot,
    env: environment,
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

const waitForJson = async (path, label) => {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
    }
  }
  throw new Error(`${label} was not written by the scratch Host.\n${redactHostOutput(output.slice(-4_000))}`)
}

try {
  await mkdir(fixtureWorkspacePath, { recursive: true })
  await writeFile(resolve(fixtureWorkspacePath, 'review.md'), '# Cold-resume target\nKeep this line fixed.\n')
  await writeFile(resolve(fixtureWorkspacePath, 'review-stale.md'), '# Stale target\nThis excerpt will change.\n')
  await writeFile(resolve(fixtureWorkspacePath, 'review-cancel.md'), '# Cancel target\nThis request may be cancelled.\n')
  await scratch.install()
  const environment = isolatedHostEnvironment(scratch.home, scratch.profileRoot)
  const dump = spawnSync('dsh', ['--profile', profileName, '--dump-config'], {
    cwd: repoRoot,
    env: environment,
    encoding: 'utf8',
  })
  assert.equal(dump.status, 0, `Scratch profile composition failed.\n${redactHostOutput(dump.stderr)}`)
  assert.ok(dump.stdout.includes('@dshfiles/agent-questions'), 'Scratch composition omitted the Agent Questions bundle.')
  assert.ok(dump.stdout.includes('@dshfiles/agent-questions-cold-resume-fixture'), 'Scratch composition omitted the cold-resume fixture.')
  await startHost()
  const prepared = await waitForJson(fixtureStatePath, 'The pending feedback state')
  assert.equal(prepared.phase, 'pending', 'The first scratch Host did not persist a pending direct-child feedback record.')
  assert.equal(prepared.childProviderCalls, 1, 'The initial child turn did not use the local provider exactly once.')
  assert.ok(prepared.parentSessionId, 'The pending feedback state omitted the parent session id.')
  assert.ok(prepared.childSessionId, 'The pending feedback state omitted the child session id.')
  assert.ok(prepared.feedbackId, 'The pending feedback state omitted the durable feedback id.')
  assert.ok(prepared.currentFeedbackId, 'The pending feedback state omitted the current feedback id.')
  assert.ok(prepared.staleFeedbackId, 'The pending feedback state omitted the stale-anchor id.')
  assert.ok(prepared.cancelledFeedbackId, 'The pending feedback state omitted the cancelled feedback id.')
  assert.ok(prepared.questionId, 'The pending question state omitted the reattachment id.')
  assert.equal(prepared.parentQuestionToolPassed, true)
  assert.equal(prepared.expiryRecommendedPassed, true)
  assert.equal(prepared.expiryDeferredPassed, true)
  assert.equal(prepared.feedbackToolsPassed, true)
  assert.equal(prepared.oversizedBatchRejected, true)
  process.stdout.write('PASS: Question answer, authorization, expiry/defer, feedback submit/read/cancel, unsafe-anchor, and batch-boundary tools passed on a fresh DSH scratch Host.\n')
  await stopHost()
  await startHost()
  const result = await waitForJson(fixtureResultPath, 'The cold-resume result')
  assert.deepEqual(result, {
    passed: true,
    parentQuestionToolPassed: true,
    unauthorizedQuestionAnswerRejected: true,
    questionReattachedAfterRestart: true,
    expiryRecommendedPassed: true,
    expiryDeferredPassed: true,
    feedbackSubmitReadCancelPassed: true,
    feedbackResolvedAfterRestart: true,
    staleAnchorRejected: true,
    oversizedBatchRejected: true,
    childAbsentAtHostRestart: true,
    childResumedAfterResolution: true,
    childProviderCalls: 2,
    feedbackStatuses: {
      current: 'resolved',
      stale: 'stale',
      cancelled: 'rejected',
      coldResume: 'resolved',
    },
    parentNotified: true,
  })
  process.stdout.write('PASS: Pending questions and feedback cold-resumed; the parent answered, resolved current/stale feedback, and the child retrieved durable receipts.\n')
} finally {
  await stopHost()
  await scratch.cleanup()
}
