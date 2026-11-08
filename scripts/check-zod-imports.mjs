#!/usr/bin/env node

/**
 * Fails when owned source imports `zod` outside a recorded bridge.
 *
 * The Effect 4.1 migration moved every schema to `effect/Schema`, but a zod import is silent until the code runs:
 * a `z.object(...)` wrapper around a plugin's Effect schema only throws deep inside an e2e journey. Keeping the
 * remaining zod imports on one short list with a reason makes an accidental re-introduction a lint failure instead
 * of a runtime surprise.
 *
 *   node scripts/check-zod-imports.mjs           # fail on an unlisted or stale entry
 *   node scripts/check-zod-imports.mjs --list    # print the allowlist and exit
 *   node scripts/check-zod-imports.mjs --root .  # scan another checkout (the gate's own test)
 */

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootArgument = process.argv.indexOf('--root')
const scannedRoot = rootArgument === -1 ? workspaceRoot : resolve(process.argv[rootArgument + 1] ?? '.')
const searchRoots = ['plugins', 'tooling', 'scripts']
const skippedDirectories = new Set(['node_modules', 'dist', 'build', '.git', '.jj', 'output', '.turbo', 'test-results', '.features-gen', 'coverage'])
const sourceExtensions = /\.[cm]?[jt]sx?$/u
const zodImport = /^\s*(?:import|export)\b[^'"]*from\s*['"]zod(?:\/[^'"]*)?['"]/mu

/** Every remaining zod import, with the reason it stays. */
const bridges = new Map([
  ['tooling/dshx/packages/dshx/src/api/zod-view.ts', 'Effect → zod bridge: dsh-storage-domain and createStoredValue take a ZodType'],
  ['plugins/@dshfiles/storage-domain/src/native/spec.ts', 'vendored native contract: the storage domain takes a ZodType from the core'],
  ['plugins/@dshfiles/storage-domain/src/native/domain.ts', 'vendored native contract: the storage domain takes a ZodType from the core'],
  ['plugins/@dshfiles/storage-domain/tests/lazy-hydration.test.ts', 'test boundary: exercises the vendored contract with a ZodType'],
  ['plugins/@dshfiles/storage-domain/tests/lazy-json-backend.test.ts', 'test boundary: exercises the vendored contract with a ZodType'],
  ['tooling/dshx/packages/dshx/tests/api-zod-schema.spec.ts', 'the bridge spec'],
  ['plugins/@dshfiles/session-controller/typert/host.js', 'derived by scripts/derive-typert.mjs from the native package, not hand-written'],
])

const sourceFiles = async (directory, found = []) => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.agents') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (skippedDirectories.has(entry.name)) continue
      await sourceFiles(path, found)
      continue
    }
    if (sourceExtensions.test(entry.name)) found.push(path)
  }
  return found
}

const check = async () => {
  const offenders = []
  const matched = new Set()
  for (const root of searchRoots) {
    for (const path of await sourceFiles(join(scannedRoot, root))) {
      const source = await readFile(path, 'utf8')
      if (!zodImport.test(source)) continue
      const relativePath = relative(scannedRoot, path)
      matched.add(relativePath)
      if (!bridges.has(relativePath)) offenders.push(relativePath)
    }
  }
  const stale = [...bridges.keys()].filter(path => !matched.has(path))
  for (const path of offenders) console.error(`${path}: imports zod; use effect/Schema, or record why this file keeps zod in scripts/check-zod-imports.mjs`)
  for (const path of stale) console.error(`${path}: listed in scripts/check-zod-imports.mjs but imports no zod; drop the entry`)
  if (offenders.length === 0 && stale.length === 0) {
    console.log(`zod imports: ${String(matched.size)} recorded bridges, none unlisted.`)
    return
  }
  process.exitCode = 1
}

if (process.argv.includes('--list')) {
  for (const [path, reason] of bridges) console.log(`${path} — ${reason}`)
} else await check()
