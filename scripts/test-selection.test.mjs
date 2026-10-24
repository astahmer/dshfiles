import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { selectTests } from './test-selection.mjs'

const packages = [
  { name: 'core', directory: 'plugins/@dshfiles/core', test: 'vitest run', dependencies: [] },
  { name: 'consumer', directory: 'plugins/@dshfiles/consumer', test: 'vitest run', dependencies: ['core'] },
  { name: 'unrelated', directory: 'plugins/@dshfiles/unrelated', test: 'vitest run', dependencies: [] },
]

const summarize = selection => selection.map(({ name, mode }) => ({ name, mode }))
const selectionScript = fileURLToPath(new URL('./test-selection.mjs', import.meta.url))

const dryRun = path => JSON.parse(execFileSync(process.execPath, [selectionScript, 'related', path, '--dry-run'], { encoding: 'utf8' }))
const dryRunAutoBuild = path =>
  JSON.parse(execFileSync(process.execPath, [selectionScript, 'related', path, '--dry-run', '--build=auto'], { encoding: 'utf8' }))

test('auto build is the default and skips source-only related runs', () => {
  assert.equal(dryRun('plugins/@dshfiles/shared-streams/src/shim.ts').build.required, false)
})

test('auto build skips source-only related runs and builds dist loaders and full dependents', () => {
  assert.equal(dryRunAutoBuild('plugins/@dshfiles/shared-streams/src/shim.ts').build.required, false)
  const distLoader = dryRunAutoBuild('plugins/@dshfiles/prompt-stash/src/host.ts')
  assert.equal(distLoader.build.required, true)
  assert.match(distLoader.build.reason, /loads dist/)
  const dependent = dryRunAutoBuild('plugins/@dshfiles/usage/src/command-identifiers.ts')
  assert.equal(dependent.build.required, true)
  assert.match(dependent.build.reason, /full suite/)
})

test('consumer narrowing selects fewer dependent tests and keeps full suites for dynamic packages', () => {
  const narrowed = JSON.parse(
    execFileSync(process.execPath, [selectionScript, 'related', 'plugins/@dshfiles/usage/src/session-log.ts', '--dry-run', '--consumers=related'], {
      encoding: 'utf8',
    }),
  )
  assert.equal(narrowed.build.required, true)
  assert.ok(narrowed.consumers.length > 0)
  assert.ok(narrowed.consumers.every(consumer => consumer.tests < 5))
  const fullSuites = narrowed.packages.filter(packageInfo => packageInfo.mode === 'full').map(packageInfo => packageInfo.name)
  assert.ok(fullSuites.includes('@dshfiles/jj-integration'))
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
