import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { decodeJson } from './json.ts'

/**
 * Boot a profile and fail on any entry that did not activate.
 *
 * `dsh` prints one line per entry that failed to activate and the tokenized URL,
 * and non-fatal failures only reach stdout (AGENTS.md, "Verifying anything").
 * The Host keeps running after the URL, so this waits a settle window for late
 * activation lines, then stops the whole process group: the pnpm shim does not
 * forward signals to the node process it starts.
 */

const failureMarkers = [
  'did not activate',
  'failed to import',
  'Failed to load plugins',
  'fatal uncaught exception',
  'Cannot find module',
  'ERR_MODULE_NOT_FOUND',
]

const { values } = parseArgs({
  options: {
    profile: { type: 'string', default: 'probe' },
    port: { type: 'string', default: '3097' },
    'timeout-ms': { type: 'string', default: '90000' },
    'settle-ms': { type: 'string', default: '10000' },
  },
})

const expectedNode = `v${readFileSync(join(import.meta.dirname, '../.node-version'), 'utf8').trim()}`
if (process.version !== expectedNode) {
  console.error(
    `dsh must run on the official Node build ${expectedNode}, not ${process.version}. Run: fnm exec --using=${expectedNode.slice(1)} node scripts/profile-boot.ts`,
  )
  process.exit(2)
}

const profileManifest = decodeJson(
  z.object({ dsh: z.object({ profile: z.object({ bundles: z.array(z.string()) }) }) }),
  readFileSync(join(homedir(), '.dsh/profiles', values.profile, 'package.json'), 'utf8'),
)
const composed = execFileSync('dsh', ['--profile', values.profile, '--dump-config'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const missing = profileManifest.dsh.profile.bundles.filter(name => name.startsWith('@dshfiles/') && !composed.includes(`name: '${name}'`))
if (missing.length > 0) {
  console.error(`profile ${values.profile}: bundles absent from the composed config: ${missing.join(', ')}`)
  process.exit(1)
}

const child = spawn('dsh', ['--profile', values.profile, '--port', values.port, '--no-open'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
child.stdout.on('data', chunk => (output += String(chunk)))
child.stderr.on('data', chunk => (output += String(chunk)))

const announced = await new Promise<boolean>(resolve => {
  const deadline = setTimeout(() => resolve(false), Number(values['timeout-ms']))
  const poll = setInterval(() => {
    if (!/http:\/\/127\.0\.0\.1:\d+\//.test(output)) return
    clearInterval(poll)
    clearTimeout(deadline)
    resolve(true)
  }, 250)
  child.once('exit', () => {
    clearInterval(poll)
    clearTimeout(deadline)
    resolve(false)
  })
})
if (announced) await new Promise(resolve => setTimeout(resolve, Number(values['settle-ms'])))

const stopGroup = (signal: NodeJS.Signals): void => {
  if (child.pid === undefined || child.exitCode !== null) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    return
  }
}
stopGroup('SIGTERM')
await new Promise(resolve => setTimeout(resolve, 3000))
stopGroup('SIGKILL')

const redacted = output.replace(/token=[\w-]+/g, 'token=[REDACTED]')
const failures = redacted
  .split('\n')
  .map(line => line.trim())
  .filter(line => failureMarkers.some(marker => line.includes(marker)))

if (!announced) {
  console.error(`profile ${values.profile}: the Host never announced a URL\n${redacted}`)
  process.exit(1)
}
if (failures.length > 0) {
  console.error(`profile ${values.profile}: ${failures.length} activation failure(s)\n${failures.join('\n')}`)
  process.exit(1)
}
console.log(`profile ${values.profile}: booted with no activation failures`)
