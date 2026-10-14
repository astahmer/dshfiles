#!/usr/bin/env node

/**
 * Runs the journeys one package owns (its `test:e2e` task), or only their `@smoke` scenarios with `--smoke`, against
 * bundles the caller already built. Root `pnpm check:e2e` builds once and runs these through Turbo, which replays a
 * package whose inputs did not change.
 */

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planBrowserTasks } from './browser-tasks.mjs'

const dshxRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const smoke = process.argv.includes('--smoke')
const { name } = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'))
const owner = (await planBrowserTasks()).owners.get(name)
const features = smoke ? owner?.smokeFeatures : owner?.features
if (features === undefined || features.length === 0) throw new Error(`${name} owns no ${smoke ? '@smoke ' : ''}journeys; regenerate with browser-tasks.mjs --write.`)

const run = (command, args) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: dshxRoot, stdio: 'inherit', env: { ...process.env, DSHX_E2E_PREBUILT: '1' } })
    child.once('error', reject)
    child.once('close', code => resolveRun(code ?? 1))
  })

const generated = await run('pnpm', ['exec', 'bddgen', 'test', '--config=playwright.e2e.config.ts'])
if (generated !== 0) process.exit(generated)
const fileFilters = features.map(feature => `/features/${feature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.feature\\.spec\\.js$`)
process.exitCode = await run('pnpm', [
  'exec',
  'playwright',
  'test',
  '--config=playwright.e2e.config.ts',
  '--workers=1',
  ...(smoke ? ['--grep', '@smoke'] : []),
  ...fileFilters,
])
