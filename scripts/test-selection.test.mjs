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
