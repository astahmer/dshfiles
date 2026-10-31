import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../')
if (process.versions.node !== '22.23.3') throw new Error(`Use Node 22.23.3 for DSH acceptance; found ${process.versions.node}.`)

const pnpmVersion = spawnSync('pnpm', ['--version'], { encoding: 'utf8' })
if (pnpmVersion.status !== 0 || pnpmVersion.stdout.trim() !== '12.5.1') {
  throw new Error(`Use pnpm 12.5.1 for DSH acceptance; found ${pnpmVersion.stdout.trim() || 'unavailable'}.`)
}

const dshVersion = spawnSync('dsh', ['--version'], { encoding: 'utf8' })
if (dshVersion.status !== 0 || dshVersion.stdout.trim() !== '0.2.1-rc.2') {
  throw new Error(`Scratch acceptance requires DSH 0.2.1-rc.2; found ${dshVersion.stdout.trim() || 'unavailable'}.`)
}

const scratchProfilePath = resolve(repoRoot, 'tooling/dshx/packages/dshx/dist/project/scratch-profile.js')
const { createScratchProfile, ScratchProfileRuntime } = await import(pathToFileURL(scratchProfilePath).href)
const isolatedHostEnvironment = ScratchProfileRuntime.hostEnvironment
const redactHostOutput = ScratchProfileRuntime.redactHostOutput
const pluginRoot = resolve(repoRoot, 'plugins/@dshfiles/tool-search')
const profileName = 'tool-search'
const scratch = await createScratchProfile({
  profileName,
  sourceProfileRoot: resolve(homedir(), '.dsh/profiles/web'),
  bundleIds: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dshfiles/tool-search'],
  excludedDependencyPrefixes: ['@dshfiles/', '@mars-sea/', 'dshmarket'],
  extraDependencies: { '@dshfiles/tool-search': `link:${pluginRoot}` },
})

let host
let hostExited
let output = ''

const startHost = async () => {
  output = ''
  const child = spawn('dsh', ['--profile', profileName, '--port', '0', '--no-open'], {
    cwd: repoRoot,
    env: isolatedHostEnvironment(scratch.home, scratch.profileRoot),
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
        rejectReady(new Error(`Scratch Host did not become ready.\n${redactHostOutput(output.slice(-4_000))}`))
      }, 45_000)
      const inspect = () => {
        if (!/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/.test(output)) return
        clearTimeout(timeout)
        resolveReady()
      }
      child.stdout.on('data', inspect)
      child.stderr.on('data', inspect)
      child.once('error', error => {
        clearTimeout(timeout)
        rejectReady(new Error(`Scratch Host could not start: ${error.name}.`))
      })
      child.once('exit', (code, signal) => {
        if (/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/.test(output)) return
        clearTimeout(timeout)
        rejectReady(new Error(`Scratch Host exited before ready: code=${String(code)}, signal=${String(signal)}.\n${redactHostOutput(output.slice(-4_000))}`))
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
  if (host === undefined || host.exitCode !== null || host.signalCode !== null) return
  host.kill('SIGTERM')
  let timeout
  try {
    await Promise.race([
      hostExited,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Owned scratch Host did not stop within 5 seconds.')), 5_000)
      }),
    ])
  } catch (error) {
    host.kill('SIGKILL')
    await hostExited
    throw error
  } finally {
    clearTimeout(timeout)
  }
  host = undefined
}

try {
  await scratch.install()
  const environment = isolatedHostEnvironment(scratch.home, scratch.profileRoot)
  const dump = spawnSync('dsh', ['--profile', profileName, '--dump-config'], { cwd: repoRoot, env: environment, encoding: 'utf8' })
  assert.equal(dump.status, 0, `Scratch profile composition failed.\n${redactHostOutput(dump.stderr)}`)
  assert.ok(dump.stdout.includes('@dshfiles/tool-search'), 'Scratch composition omitted the Tool Search bundle.')
  await startHost()
  process.stdout.write('PASS: Tool Search activated in an isolated scratch DSH Host.\n')

  const integration = spawnSync('pnpm', ['--dir', pluginRoot, 'exec', 'vitest', 'run', 'src/agent-loop.integration.test.ts'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  const integrationOutput = redactHostOutput(`${integration.stdout}\n${integration.stderr}`)
  assert.equal(integration.status, 0, `The AgentLoop acceptance journey failed.\n${integrationOutput}`)
  process.stdout.write('PASS: progressive tool discovery passed the real AgentLoop acceptance journey.\n')
} finally {
  await stopHost()
  await scratch.cleanup()
}
