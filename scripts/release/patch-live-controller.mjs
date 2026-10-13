#!/usr/bin/env node
/**
 * Patch the LIVE dsh installation's session controller, resolving the
 * installation from the running process rather than from a hardcoded path.
 *
 * This is the fix for the deployment that silently missed: `nixapply` recreated
 * the pnpm global install under a new content hash, the `dsh` shim followed it,
 * and a patch keyed to the previous hash sat in a stale directory while
 * production kept loading the unpatched controller.
 *
 * Usage: node scripts/release/patch-live-controller.mjs [--verify|--rollback]
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const STAGE = resolve(process.env.HOME, '.dsh-staging/rc-543db674')
const PATCHED = join(STAGE, 'session-controller.patched.js')
const mode = process.argv[2] ?? '--apply'

/** The installation the running Host actually loads, read from its own argv. */
const runningInstall = () => {
  const pid = execFileSync('lsof', ['-nP', '-iTCP:3080', '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n')[0]
  if (pid === '' || pid === undefined) return undefined
  const argv = execFileSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' })
  const match = /(\/Users\/[^ ]*\/global\/v11\/[0-9a-f]+)\/node_modules\/@deepseek-ai\/dsh\//.exec(argv)
  return match?.[1]
}

/** The installation the `dsh` shim resolves to, for when no Host is running. */
const shimInstall = () => {
  const shim = resolve(process.env.HOME, '.local/share/pnpm/bin/dsh')
  if (!existsSync(shim)) return undefined
  const text = readFileSync(shim, 'utf8')
  const match = /(\/Users\/[^ ]*\/global\/v11\/[0-9a-f]+)/.exec(text)
  return match?.[1]
}

const controllerOf = install => {
  const store = join(install, 'node_modules/.pnpm')
  const entry = readdirSync(store).find(name => name.startsWith('@deepseek-ai+dsh-api-session-controller@'))
  if (entry === undefined) throw new Error(`no session controller in ${install}`)
  return join(store, entry, 'node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js')
}

const install = runningInstall() ?? shimInstall()
if (install === undefined) throw new Error('could not resolve the dsh installation from the running Host or the shim')
const controller = controllerOf(install)
const patched = readFileSync(PATCHED, 'utf8')
const current = readFileSync(controller, 'utf8')
const isPatched = current.includes('resolveByPath(cwd)')

console.log('installation :', install)
console.log('controller   :', controller)
console.log('state        :', isPatched ? 'PATCHED' : 'UNPATCHED')

if (mode === '--verify') {
  if (!isPatched) {
    console.error('\nFAIL: the running installation does not carry the attach fix.')
    process.exitCode = 1
  } else {
    console.log('\nOK: create:', current.includes('resolveByPath(cwd)'), '| fork:', current.includes('resolveByPath(childCwd)'))
  }
} else if (mode === '--rollback') {
  const backup = join(STAGE, 'session-controller.rollback-live.js')
  if (!existsSync(backup)) throw new Error(`no backup at ${backup}`)
  copyFileSync(backup, controller)
  console.log('rolled back to', backup)
} else {
  if (isPatched) {
    console.log('already patched; nothing to do')
  } else {
    const backup = join(STAGE, 'session-controller.rollback-live.js')
    copyFileSync(controller, backup)
    console.log('backed up to :', backup)
    copyFileSync(PATCHED, controller)
    console.log('applied      :', PATCHED)
  }
  const after = readFileSync(controller, 'utf8')
  console.log('now          : create:', after.includes('resolveByPath(cwd)'), '| fork:', after.includes('resolveByPath(childCwd)'))
}
