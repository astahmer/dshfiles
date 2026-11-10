#!/usr/bin/env node

/**
 * Fail a Client plugin that re-inlines a library the shared runtime already provides.
 *
 * `@dshfiles/shared-runtime` supplies one copy of the UI stack (radix, tanstack, motion, zod, …) through the DSH
 * module table. A Client plugin that forgets `client.shared` silently keeps its own copy of every one of those
 * packages: measured on this repo, that was ~1.3 MB of duplicated bundle bytes plus duplicate module-level state
 * (a second QueryClient snapshot cache, a second zod registry, independent radix portals).
 *
 * The check reads what each built Client bundle actually retained (`dist/client.js.deps.json`, written by
 * `dshx build`), so it reports the truth about the artifact rather than what a config claims. A plugin that
 * intends a private copy declares it in `client.bundleDependencies`, which this check honours.
 *
 * Run after `pnpm --dir plugins run build`; wired as `pnpm check:shared-runtime` in `check:green`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const pluginsRoot = join(repositoryRoot, 'plugins', '@dshfiles')
const supplierName = '@dshfiles/shared-runtime'
const supplierManifest = join(pluginsRoot, 'shared-runtime', 'dist', 'shared-runtime.json')

if (!existsSync(supplierManifest)) {
  console.error(`shared runtime: ${supplierName} is not built; run "pnpm --dir plugins run build" first.`)
  process.exit(1)
}

/** Exact specifiers the supplier exports, grouped back to the package each one belongs to. */
const providedPackages = new Set()
for (const specifier of Object.keys(JSON.parse(readFileSync(supplierManifest, 'utf8')).modules)) {
  providedPackages.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0])
}

const packageNameOf = source => {
  const marker = '/node_modules/'
  const index = source.lastIndexOf(marker)
  if (index < 0) return undefined
  const rest = source.slice(index + marker.length).split('/')
  return rest[0]?.startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0]
}

const plugins = readdirSync(pluginsRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort()

const findings = []
let inspected = 0

for (const name of plugins) {
  if (name === 'shared-runtime') continue
  const directory = join(pluginsRoot, name)
  const depsFile = join(directory, 'dist', 'client.js.deps.json')
  const configFile = join(directory, 'dshx.config.ts')
  if (!existsSync(depsFile) || !existsSync(configFile)) continue
  inspected += 1
  const config = readFileSync(configFile, 'utf8')
  if (config.includes(`shared: '${supplierName}'`)) continue
  const privateCopies = new Set(
    (/(?:client:\s*\{[\s\S]*?bundleDependencies:\s*\[([^\]]*)\])/u.exec(config)?.[1] ?? '')
      .split(',')
      .map(value => value.trim().replace(/^['"]|['"]$/gu, ''))
      .filter(Boolean),
  )
  const retained = new Set()
  for (const source of JSON.parse(readFileSync(depsFile, 'utf8')).sources ?? []) {
    const packageName = packageNameOf(String(source))
    if (packageName === undefined || !providedPackages.has(packageName)) continue
    if (privateCopies.has(packageName)) continue
    retained.add(packageName)
  }
  if (retained.size > 0) findings.push({ name, packages: [...retained].sort() })
}

if (findings.length === 0) {
  console.log(`shared runtime: ${inspected} Client bundles, no re-inlined ${supplierName} module`)
  process.exit(0)
}

console.error(`shared runtime: ${findings.length} Client plugin(s) bundle a library ${supplierName} already provides:`)
for (const finding of findings) {
  console.error(`  @dshfiles/${finding.name}: ${finding.packages.join(', ')}`)
}
console.error(`\nAdd "shared: '${supplierName}'" to the plugin's dshx.config.ts client block, add the supplier to`)
console.error(`package.json dependencies and dsh.client.external, and rebuild. For a deliberate private copy, list the`)
console.error(`package in client.bundleDependencies with a comment saying why.`)
process.exit(1)
