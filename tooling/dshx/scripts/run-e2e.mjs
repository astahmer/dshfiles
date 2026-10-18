#!/usr/bin/env node

/**
 * Runs the journeys one package owns (its `test:e2e` task), or only their `@smoke` scenarios with `--smoke`, against
 * bundles the caller already built. Root `pnpm check:e2e` builds once and runs these through Turbo, which replays a
 * package whose inputs did not change.
 *
 * `DSHX_E2E_MAX_FAILURES` stops a broad run's first red owner early, and `DSHX_E2E_WORKERS` raises the worker count
 * for a measured run. Both are passed through by the generated task environment.
 *
 * `DSHX_E2E_GENERATED=1` says the caller already ran `bddgen` for this harness: root `pnpm check:e2e` generates the 48
 * specs once instead of once per owner (measured 3.6-4.8s each, ~2.6 minutes of a broad run). A missing spec for one
 * of this owner's features falls back to generating here.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planBrowserTasks } from './browser-tasks.mjs'

const dshxRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const smoke = process.argv.includes('--smoke')
const maxFailures = process.env.DSHX_E2E_MAX_FAILURES ?? ''
const workers = process.env.DSHX_E2E_WORKERS ?? '1'
const { name } = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'))
const owner = (await planBrowserTasks()).owners.get(name)
const features = smoke ? owner?.smokeFeatures : owner?.features
if (features === undefined || features.length === 0)
  throw new Error(`${name} owns no ${smoke ? '@smoke ' : ''}journeys; regenerate with browser-tasks.mjs --write.`)

const run = (command, args) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: dshxRoot, stdio: 'inherit', env: { ...process.env, DSHX_E2E_PREBUILT: '1' } })
    child.once('error', reject)
    child.once('close', code => resolveRun(code ?? 1))
  })

const specExists = feature => existsSync(join(dshxRoot, '.features-gen/web-e2e/e2e/features', `${feature}.feature.spec.js`))
const reuseGenerated = process.env.DSHX_E2E_GENERATED === '1' && features.every(specExists)
console.log(reuseGenerated ? 'run-e2e: reusing the specs this run generated once' : 'run-e2e: generating the BDD specs for this owner')
if (!reuseGenerated) {
  const generated = await run('pnpm', ['exec', 'bddgen', 'test', '--config=playwright.e2e.config.ts'])
  if (generated !== 0) process.exit(generated)
}
const fileFilters = features.map(feature => `/features/${feature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.feature\\.spec\\.js$`)
process.exitCode = await run('pnpm', [
  'exec',
  'playwright',
  'test',
  '--config=playwright.e2e.config.ts',
  `--workers=${workers}`,
  ...(maxFailures === '' ? [] : [`--max-failures=${maxFailures}`]),
  ...(smoke ? ['--grep', '@smoke'] : []),
  ...fileFilters,
])
