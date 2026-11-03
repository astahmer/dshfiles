#!/usr/bin/env node

/**
 * Deterministic CI shards for the plugin workspace.
 *
 * The merge gate used to run every owned bundle's build, typecheck, test and boot in one serial job: 2006s of one
 * runner. This script slices the same Turbo work across parallel runners without changing what is asserted — it only
 * answers "which packages does this shard own", so the local `pnpm check` and the CI job run the same commands.
 *
 *   node scripts/ci/plugin-shard.mjs <index> <count>            # build+typecheck+test slice (local parity)
 *   node scripts/ci/plugin-shard.mjs <index> <count> unit       # build+test slice    (units matrix)
 *   node scripts/ci/plugin-shard.mjs <index> <count> boot       # plugin boot slice   (boot matrix)
 *   node scripts/ci/plugin-shard.mjs <index> <count> smoke      # smoke journeys      (e2e-smoke matrix)
 *
 * Packages are listed by directory name and assigned round-robin (`index % count`), so the slice is identical on every
 * run and on every machine: a shard index never means a different package because of timing or hash order. A boot shard
 * that owns nothing falls back to the composed web-profile boot, which always has to run exactly once.
 *
 * A selection only narrows what runs. `pnpm --dir plugins run test` (no argument) still runs every package, and
 * `scripts/check-browser.mjs boot <names>` builds each selected owner's own boot closure.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const pluginsRoot = resolve(workspaceRoot, 'plugins/@dshfiles')
const composedOwner = 'dshfiles-plugins'

const run = (command, args, options = {}) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: workspaceRoot, stdio: 'inherit', ...options })
    child.once('error', reject)
    child.once('close', code => resolveRun(code ?? 1))
  })

const listPluginPackages = async () => {
  const entries = await readdir(pluginsRoot, { withFileTypes: true })
  const packages = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const manifestPath = resolve(pluginsRoot, entry.name, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (typeof manifest.name !== 'string') continue
    packages.push({
      name: manifest.name,
      directory: `plugins/@dshfiles/${entry.name}`,
      isBundle: manifest.dsh !== undefined,
      hasSmoke: typeof manifest.scripts?.['test:e2e:smoke'] === 'string',
    })
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name))
}

const parseShard = argv => {
  const index = Number.parseInt(argv[0] ?? '', 10)
  const count = Number.parseInt(argv[1] ?? '', 10)
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 0 || index >= count) {
    console.error('usage: node scripts/ci/plugin-shard.mjs <index> <count> [boot]')
    process.exit(2)
  }
  return { index, count, mode: argv[2] ?? 'test' }
}

const { index, count, mode } = parseShard(process.argv.slice(2))
const packages = await listPluginPackages()
const sliceOf = items => items.filter((_, position) => position % count === index)

if (mode === 'test' || mode === 'unit') {
  const slice = sliceOf(packages)
  if (slice.length === 0) {
    console.log(`plugin shard ${String(index)}/${String(count)}: no package (nothing to test)`)
    process.exit(0)
  }
  console.log(`plugin shard ${String(index)}/${String(count)}: ${slice.map(item => item.name).join(', ')}`)
  // The same Turbo tasks the three local plugin commands run (`check:plugins` = contract + build + typecheck + test),
  // one `--filter` per owned package (Turbo unions filters). `typecheck` and `test` both dependOn `build`, so the build
  // runs once here and is replayed from the local cache by the test invocation — splitting typecheck into its own CI
  // job would instead pay the ~260s plugin build twice.
  const filters = slice.map(item => `--filter=${item.name}`)
  // `unit` leaves typecheck to the CI `types` job, which runs the whole plugin typecheck once instead of paying it in
  // every shard; `test` (the local shape) keeps all three so a single command still proves what `pnpm check` proves.
  const tasks = mode === 'unit' ? ['build'] : ['build', 'typecheck']
  const built = await run('pnpm', ['exec', 'node', 'scripts/turbo.mjs', 'run', ...tasks, ...filters])
  if (built !== 0) process.exit(built)
  // `--testTimeout=30000` is a vitest argument, so it may only be appended to the test task, never to build/typecheck.
  process.exit(await run('pnpm', ['exec', 'node', 'scripts/turbo.mjs', 'run', 'test', ...filters, '--', '--testTimeout=30000']))
}

if (mode === 'boot') {
  const bundles = packages.filter(item => item.isBundle)
  const slice = sliceOf(bundles)
  // The composed boot loads every bundle in one profile, so it belongs to exactly one shard: the first that owns any
  // bundle. A shard with bundles after that one runs only its own per-plugin boots.
  const owners = slice.map(item => item.name.replace('@dshfiles/', ''))
  if (index === 0 || slice.length === 0) owners.push(composedOwner)
  console.log(`plugin boot shard ${String(index)}/${String(count)}: ${owners.join(', ')} (composed: ${String(index === 0 || slice.length === 0)})`)
  process.exit(await run('node', ['scripts/check-browser.mjs', 'boot', ...owners]))
}

if (mode === 'smoke') {
  // Only owners that actually declare a smoke journey take part, and the round-robin covers every one of them.
  const owners = packages.filter(item => item.hasSmoke).map(item => item.name.replace('@dshfiles/', ''))
  const slice = sliceOf(owners)
  if (slice.length === 0) {
    console.log(`e2e smoke shard ${String(index)}/${String(count)}: no owner (nothing to run)`)
    process.exit(0)
  }
  console.log(`e2e smoke shard ${String(index)}/${String(count)}: ${slice.join(', ')}`)
  process.exit(await run('node', ['scripts/check-browser.mjs', 'smoke', ...slice]))
}

console.error(`unknown shard mode "${mode}" (expected test, boot or smoke)`)
process.exit(2)
