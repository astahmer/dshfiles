#!/usr/bin/env node

/**
 * Fails when a profile config stores a `secret:ALIAS` reference the Secret Catalog cannot resolve.
 *
 * A reference is only text. When its alias is missing the profile still boots and every call that reads the
 * credential fails later with `WEB_PROVIDER_CREDENTIAL_MISSING`-style errors, so a lost alias (an untracked global
 * config, a moved nixfiles checkout) looks like a broken plugin. Settings resolve with `cwd: null`, which reads
 * global aliases only: a reference that exists solely in a project or machine-local scope can never resolve there.
 * An alias no config declares still resolves when the vault stores a unique item named `global/<alias>`; that case is
 * reported, not failed.
 *
 *   node scripts/check-secret-refs.mjs                 # every live and seeded profile config
 *   node scripts/check-secret-refs.mjs --aliases FILE   # inventory from a fixture instead of `secret print`
 *   node scripts/check-secret-refs.mjs --profiles DIR   # scan another profile root (the gate's own test)
 *
 * Never reads or prints a value: the inventory command lists alias metadata only.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** `secret:ALIAS` or `secret:ALIAS@ENV` exactly as the credential grammar spells it. */
export const SecretRefs = {
  pattern: /secret:([A-Za-z_][A-Za-z0-9_-]*)(?:@([A-Za-z0-9_-]+))?/gu,

  /** Every distinct alias/environment pair a config text stores, in first-seen order. */
  collect(text) {
    const seen = new Map()
    for (const match of text.matchAll(SecretRefs.pattern)) {
      const alias = match[1]
      const environment = match[2] ?? 'prod'
      seen.set(`${alias}\u0000${environment}`, { alias, environment })
    }
    return [...seen.values()]
  },

  /** The config files a profile boots from; a missing directory yields nothing. */
  configFiles(profileRoot) {
    if (!existsSync(profileRoot)) return []
    return readdirSync(profileRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .flatMap(entry => ['cordis.patch.yml', 'cordis.yml'].map(name => join(profileRoot, entry.name, name)))
      .filter(file => existsSync(file))
  },

  /**
   * Partition references against the alias inventory. `missing` never resolves; `narrow` resolves in a project or
   * machine-local scope only, which the Host settings resolver (`cwd: null`) never reads.
   */
  check(references, inventory) {
    const scopes = new Map()
    for (const row of inventory) {
      const key = `${row.alias}\u0000${row.env ?? 'prod'}`
      const known = scopes.get(key) ?? []
      scopes.set(key, [...known, row.scope])
    }
    const missing = []
    const narrow = []
    for (const reference of references) {
      const found = scopes.get(`${reference.alias}\u0000${reference.environment}`) ?? []
      if (found.length === 0) missing.push(reference)
      else if (!found.includes('global')) narrow.push({ ...reference, scopes: found })
    }
    return { missing, narrow }
  },
}

const argumentValues = name => {
  const values = []
  const argv = process.argv.slice(2)
  for (let index = 0; index < argv.length; index += 1) if (argv[index] === name && argv[index + 1] !== undefined) values.push(argv[index + 1])
  return values
}

const inventoryFromCli = () => {
  try {
    return JSON.parse(execFileSync('secret', ['print', '--all', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  } catch (cause) {
    const reason = cause instanceof Error && 'stderr' in cause ? String(cause.stderr).trim() : String(cause)
    throw new Error(`secret print --all --json failed; run "secret doctor" first. ${reason}`)
  }
}

/** A missing alias still resolves when the vault holds a unique item named global/<alias>; ask the CLI, not the config. */
const resolvesThroughVault = alias => {
  try {
    execFileSync('secret', ['id', alias], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return true
  } catch {
    return false
  }
}

const describe = reference => `${reference.alias}${reference.environment === 'prod' ? '' : `@${reference.environment}`}`

const main = () => {
  const aliasFixture = argumentValues('--aliases')[0]
  const inventory = aliasFixture === undefined ? inventoryFromCli() : JSON.parse(readFileSync(aliasFixture, 'utf8'))
  const profileRoots = argumentValues('--profiles')
  const roots = profileRoots.length > 0 ? profileRoots : [join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles'), join(workspaceRoot, 'profiles')]
  const files = roots.flatMap(SecretRefs.configFiles)
  const references = files.flatMap(file => SecretRefs.collect(readFileSync(file, 'utf8')).map(reference => ({ ...reference, file })))
  const { missing, narrow } = SecretRefs.check(references, inventory)
  // Only the live inventory can answer for the vault; a fixture run stays offline and deterministic.
  const fromVault = aliasFixture === undefined ? missing.filter(reference => reference.environment === 'prod' && resolvesThroughVault(reference.alias)) : []
  const stillMissing = missing.filter(reference => !fromVault.includes(reference))

  for (const reference of fromVault)
    console.log(`${reference.file} binds ${describe(reference)}: no alias, resolved through the vault item global/${reference.alias}.`)
  for (const reference of narrow)
    console.warn(
      `warn: ${reference.file} binds ${describe(reference)}, which exists only in the ${reference.scopes.join('/')} scope; settings resolve global aliases only.`,
    )
  if (stillMissing.length === 0 && narrow.length === 0) {
    console.log(`secret refs: ${references.length} reference(s) across ${files.length} profile config(s), all resolvable.`)
    return 0
  }
  for (const reference of stillMissing)
    console.error(
      `missing: ${reference.file} binds ${describe(reference)}; add the alias to the global config (nixfiles assets/secret/global.json, then commit) or run "secret set ${reference.alias} --global".`,
    )
  console.error(`secret refs: ${stillMissing.length} missing, ${narrow.length} not in the global scope.`)
  return 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main()
