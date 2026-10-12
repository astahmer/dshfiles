#!/usr/bin/env node
import { accessSync, chmodSync, constants, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * Installs the jj-isolation shim as `<bindir>/jj`.
 *
 * The shim is deliberately not installed by any automatic step: it changes how
 * every agent in the repository talks to jj, so enabling it is an explicit,
 * reversible act. Remove `<bindir>/jj` to disable it.
 *
 * The real jj path is baked in at install time so the read path costs one shell
 * exec, not a PATH scan.
 */

const here = dirname(fileURLToPath(import.meta.url))
const bindirIndex = process.argv.indexOf('--bindir')
const bindir = resolve(bindirIndex === -1 ? join(here, '..', '..', '.jj-isolation-bin') : process.argv[bindirIndex + 1])
const guard = resolve(here, 'cli.mjs')
const target = join(bindir, 'jj')

const foundRealJj = () => {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir.length === 0 || resolve(dir) === bindir) continue
    const candidate = join(dir, 'jj')
    try {
      accessSync(candidate, constants.X_OK)
      return realpathSync(candidate)
    } catch {
      continue
    }
  }
  throw new Error('install-shim: no jj executable found on PATH; pass JJ_ISOLATION_REAL_JJ or fix PATH.')
}

const realJj = process.env.JJ_ISOLATION_REAL_JJ ?? foundRealJj()
const template = readFileSync(join(here, 'shim-jj.sh'), 'utf8')
const dryRun = process.argv.includes('--dry-run')
if (dryRun) {
  process.stdout.write(`would install ${target} -> guard ${guard}, real jj ${realJj}\n`)
  process.exit(0)
}

mkdirSync(bindir, { recursive: true })
writeFileSync(target, template.replace('@GUARD@', guard).replace('@REAL_JJ@', realJj), 'utf8')
chmodSync(target, 0o755)

process.stdout.write(`${target}\n`)
process.stdout.write(`  real jj: ${realJj}\n`)
process.stdout.write(`Add the shim ahead of jj:\n  export PATH="${bindir}:$PATH"\n`)
