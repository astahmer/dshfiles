import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { selectTests } from './test-selection.mjs'

const packages = [
  { name: 'core', directory: 'plugins/@dshfiles/core', test: 'vitest run', dependencies: [] },
  { name: 'consumer', directory: 'plugins/@dshfiles/consumer', test: 'vitest run', dependencies: ['core'] },
  { name: 'unrelated', directory: 'plugins/@dshfiles/unrelated', test: 'vitest run', dependencies: [] },
]

// A cold checkout (CI) has no workspace dist yet, so a source-only run still needs its dependencies built.
const sourceOnlyBuild = build => build.required === false || /^unbuilt workspace dependency /.test(build.reason)

const summarize = selection => selection.map(({ name, mode }) => ({ name, mode }))
const selectionScript = fileURLToPath(new URL('./test-selection.mjs', import.meta.url))

const dryRun = path => JSON.parse(execFileSync(process.execPath, [selectionScript, 'related', path, '--dry-run'], { encoding: 'utf8' }))
const dryRunAutoBuild = path =>
  JSON.parse(execFileSync(process.execPath, [selectionScript, 'related', path, '--dry-run', '--build=auto'], { encoding: 'utf8' }))

test('auto build is the default and skips source-only related runs', () => {
  assert.ok(sourceOnlyBuild(dryRun('plugins/@dshfiles/shared-streams/src/shim.ts').build))
})

test('auto build skips source-only related runs and builds dist loaders and full dependents', () => {
  assert.ok(sourceOnlyBuild(dryRunAutoBuild('plugins/@dshfiles/shared-streams/src/shim.ts').build))
  const distLoader = dryRunAutoBuild('plugins/@dshfiles/apply-patch/src/host.ts')
  assert.equal(distLoader.build.required, true)
  assert.match(distLoader.build.reason, /loads dist/)
  const dependent = dryRunAutoBuild('plugins/@dshfiles/usage/src/command-identifiers.ts')
  assert.equal(dependent.build.required, true)
  assert.match(dependent.build.reason, /built packages|full suite/)
})

test('consumer narrowing drops unrelated dependents and keeps bundle-boot tests', () => {
  const narrowed = JSON.parse(
    execFileSync(process.execPath, [selectionScript, 'related', 'plugins/@dshfiles/usage/src/session-log.ts', '--dry-run'], { encoding: 'utf8' }),
  )
  assert.equal(narrowed.build.required, true)
  const consumers = new Map(narrowed.consumers.map(consumer => [consumer.name, consumer.tests]))
  assert.equal(consumers.get('@dshfiles/jj-integration'), 0)
  assert.ok(consumers.get('@dshfiles/thread-sidebar') >= 1)
  assert.ok([...consumers.values()].reduce((sum, count) => sum + count, 0) <= 20)
})

test('Vitest gets one passWithNoTests option for related and narrowed runs', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'test-selection-vitest-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, content, mode) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content, { mode })
  }
  const owner = 'plugins/@dshfiles/fixture-owner'
  const consumer = 'plugins/@dshfiles/ui-styles'
  const manifest = (dir, name, command, dependencies) => write(`${dir}/package.json`, JSON.stringify({ name, scripts: { test: command }, dependencies }))
  const setConsumerTest = flag => manifest(consumer, '@dshfiles/ui-styles', `vitest run ${flag}`, { '@dshfiles/fixture-owner': 'workspace:*' })
  manifest(owner, '@dshfiles/fixture-owner', 'vitest run')
  setConsumerTest('--passWithNoTests')
  write(`${owner}/src/input.ts`, 'export type Fixture = number\n')
  write(`${consumer}/src/empty.ts`, 'export {}\n')
  write(`${consumer}/tests/inert.test.ts`, "import type { Fixture } from '@dshfiles/fixture-owner'\nimport { test } from 'vitest'\ntest('inert', () => {})\n")
  const vitest = realpathSync(resolve(import.meta.dirname, '../plugins/@dshfiles/ui-styles/node_modules/vitest'))
  mkdirSync(join(root, 'tooling/dshx/packages'), { recursive: true })
  mkdirSync(join(root, 'scripts'))
  copyFileSync(selectionScript, join(root, 'scripts/test-selection.mjs'))
  copyFileSync(join(import.meta.dirname, 'turbo-cache.mjs'), join(root, 'scripts/turbo-cache.mjs'))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(resolve(import.meta.dirname, '../node_modules/effect'), join(root, 'node_modules/effect'), 'dir')
  symlinkSync(vitest, join(root, 'node_modules/vitest'), 'dir')

  // Record the selector's actual arguments and run the installed Vitest CLI. The type-only
  // dependency has no build to run, so only that Turbo command is stubbed out.
  const calls = join(root, 'calls.jsonl')
  write(
    'bin/pnpm',
    `#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const args = process.argv.slice(2)
if (args.slice(0, 4).join(' ') === 'exec turbo run build') process.exit(0)
if (args[0] !== 'exec' || args[1] !== 'vitest') process.exit(2)
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args.slice(2)) + '\\n')
const result = spawnSync(process.execPath, [${JSON.stringify(join(vitest, 'vitest.mjs'))}, ...args.slice(2)], { stdio: 'inherit' })
process.exit(result.status ?? 2)
`,
    0o755,
  )
  const run = (path, status = 0) => {
    writeFileSync(calls, '')
    const result = spawnSync(process.execPath, [join(root, 'scripts/test-selection.mjs'), 'related', path], {
      cwd: root,
      env: { ...process.env, CI: '1', PATH: `${join(root, 'bin')}:${process.env.PATH}` },
      encoding: 'utf8',
    })
    const output = `${result.stdout}${result.stderr}`
    assert.equal(result.status, status, output)
    return {
      output,
      args: readFileSync(calls, 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line)),
    }
  }

  const narrowed = run(`${owner}/src/input.ts`)
  assert.deepEqual(narrowed.args, [
    ['run', 'tests/inert.test.ts', '--passWithNoTests'],
    ['related', '--run', 'src/input.ts', '--passWithNoTests'],
  ])
  assert.match(narrowed.output, /Test Files\s+1 passed/)
  const related = run(`${consumer}/src/empty.ts`)
  assert.deepEqual(related.args, [['related', '--run', 'src/empty.ts', '--passWithNoTests']])
  assert.match(related.output, /No test files found, exiting with code 0/)
  for (const flag of ['--passWithNoTests=false', '--no-pass-with-no-tests']) {
    setConsumerTest(flag)
    const { args, output } = run(`${consumer}/src/empty.ts`, 1)
    assert.deepEqual(args, [['related', '--run', 'src/empty.ts', flag]])
    assert.match(output, /No test files found, exiting with code 1/)
  }
})

test('CLI rejects an unknown build mode', () => {
  const invalid = spawnSync(process.execPath, [selectionScript, 'related', selectionScript, '--dry-run', '--build=sometimes'], { encoding: 'utf8' })
  assert.notEqual(invalid.status, 0)
  assert.match(invalid.stderr, /--build always or auto/)
})

test('CLI routes script changes to shared checks but skips documentation', () => {
  assert.equal(dryRun(selectionScript).sharedChecks, true)
  assert.equal(dryRun(fileURLToPath(new URL('./README.md', import.meta.url))).sharedChecks, false)
})

test('CLI rejects conflicting bases and missing explicit related paths', () => {
  const conflicting = spawnSync(process.execPath, [selectionScript, 'changed', '--from', 'main', '--since', 'main', '--dry-run'], { encoding: 'utf8' })
  assert.notEqual(conflicting.status, 0)
  assert.match(conflicting.stderr, /do not combine/)
  const missing = spawnSync(process.execPath, [selectionScript, 'related', 'missing-selection-input.ts', '--dry-run'], { encoding: 'utf8' })
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /must exist/)
})

test('selects related owner tests and full dependent tests, not unrelated packages', () => {
  assert.deepEqual(summarize(selectTests({ packages, files: ['plugins/@dshfiles/core/src/value.ts'] })), [
    { name: 'core', mode: 'related' },
    { name: 'consumer', mode: 'full' },
  ])
})

test('selects full suites for manifests, fixtures, configs and deleted modules', () => {
  for (const path of ['package.json', 'tests/fixtures/value.ts', 'vitest.config.ts', 'src/styles.css']) {
    assert.equal(selectTests({ packages, files: [`plugins/@dshfiles/core/${path}`] })[0].mode, 'full')
  }
  const deleted = 'plugins/@dshfiles/core/src/value.ts'
  assert.equal(selectTests({ packages, files: [deleted], deletedFiles: [deleted] })[0].mode, 'full')
})

test('shared policies and runtime profile inputs select every suite', () => {
  for (const path of ['pnpm-lock.yaml', 'turbo.json', 'profiles/web/package.json', 'tooling/dshx/e2e/support/evidence.ts']) {
    assert.deepEqual(
      summarize(selectTests({ packages, files: [path] })),
      packages.map(({ name }) => ({ name, mode: 'full' })),
    )
  }
})

test('known dynamic test dependencies force full package suites', () => {
  const dynamicPackage = { ...packages[0], name: '@dshfiles/queue-reorder' }
  assert.equal(selectTests({ packages: [dynamicPackage], files: ['plugins/@dshfiles/core/src/client.tsx'] })[0].mode, 'full')
})

test('documentation-only changes select nothing', () => {
  assert.deepEqual(selectTests({ packages, files: ['plugins/@dshfiles/core/README.md', 'docs/checks.md'] }), [])
})

test('source-only libraries propagate selection without a test task', () => {
  const library = { ...packages[0], test: undefined }
  assert.deepEqual(summarize(selectTests({ packages: [library, packages[1]], files: ['plugins/@dshfiles/core/src/value.ts'] })), [
    { name: 'consumer', mode: 'full' },
  ])
})
