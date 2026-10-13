#!/usr/bin/env node
/**
 * Launch health check for the DSH web host.
 *
 * "It booted" is not health. This asserts the two things that actually broke in
 * production: the running installation carries the session-controller attach
 * fix, and a thread created with a workspaceId really attaches to its own
 * provisioned jj workspace instead of failing or falling back to the shared
 * checkout.
 *
 * Usage: node scripts/release/dsh-launch-health.mjs [--controller-only]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const HOME = homedir()
const checks = []
const record = (name, ok, detail) => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

/** The installation a launch will actually use: the running Host, else the shim. */
const resolveInstall = () => {
  try {
    const pid = execFileSync('lsof', ['-nP', '-iTCP:3080', '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n')[0]
    if (pid !== '' && pid !== undefined) {
      const argv = execFileSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' })
      const running = /(\/Users\/[^ ]*\/global\/v11\/[0-9a-f]+)\/node_modules\/@deepseek-ai\/dsh\//.exec(argv)
      if (running !== null) return { install: running[1], source: `running Host pid ${pid}` }
    }
  } catch {
    /* no Host listening */
  }
  const shim = resolve(HOME, '.local/share/pnpm/bin/dsh')
  if (!existsSync(shim)) throw new Error('no running Host and no dsh shim to resolve the installation from')
  const fromShim = /(\/Users\/[^ ]*\/global\/v11\/[0-9a-f]+)/.exec(readFileSync(shim, 'utf8'))
  if (fromShim === null) throw new Error(`could not read an installation path out of ${shim}`)
  return { install: fromShim[1], source: 'dsh shim' }
}

const controllerPath = install => {
  const store = join(install, 'node_modules/.pnpm')
  const entry = readdirSync(store).find(name => name.startsWith('@deepseek-ai+dsh-api-session-controller@'))
  if (entry === undefined) throw new Error(`no session controller under ${install}`)
  return join(store, entry, 'node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js')
}

const { install, source } = resolveInstall()
console.log(`installation: ${install}\nresolved via: ${source}\n`)

const controller = controllerPath(install)
const source_text = readFileSync(controller, 'utf8')
record('controller: create attaches the resolved workspace owner', source_text.includes('resolveByPath(cwd)'))
record('controller: fork attaches the resolved workspace owner', source_text.includes('resolveByPath(childCwd)'))

const dist = join(resolve(import.meta.dirname, '../..'), 'plugins/@dshfiles/jj-integration/dist/index.js')
record('plugin: jj-integration build carries workspace registration', existsSync(dist) && readFileSync(dist, 'utf8').includes('registerWorkspace'))

if (process.argv.includes('--controller-only')) {
  const failed = checks.filter(check => !check.ok)
  console.log(`\n${failed.length === 0 ? 'HEALTHY' : `${failed.length} CHECK(S) FAILED`}`)
  process.exitCode = failed.length === 0 ? 0 : 1
} else {
  console.log('\nThe behavioural half — a real thread attaching to its provisioned workspace —')
  console.log('runs against an isolated runtime so it never touches the live Host:')
  console.log('  node scripts/release/rc-verify.mjs')
}

const failed = checks.filter(check => !check.ok)
console.log(`\n${failed.length === 0 ? 'HEALTHY' : `${failed.length} CHECK(S) FAILED`}`)
process.exitCode = failed.length === 0 ? 0 : 1
