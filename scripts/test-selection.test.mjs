import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
// Run the unchanged CLI from a private repository: its root is derived from import.meta.url.
// Only zod is linked from the installation; every package and build entry is fixture-owned.
const buildFixture = t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'test-selection-')))
  t.after(() => {
    assert.equal(realpathSync(root), root)
    rmSync(root, { recursive: true, force: true })
  })
  const write = (path, content) => {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  write('package.json', JSON.stringify({ private: true, type: 'module' }))
  mkdirSync(join(root, 'scripts'))
  for (const name of ['test-selection.mjs', 'turbo-cache.mjs']) copyFileSync(new URL(name, import.meta.url), join(root, 'scripts', name))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(fileURLToPath(new URL('../node_modules/zod', import.meta.url)), join(root, 'node_modules/zod'), 'dir')
  write('tooling/dshx/packages/dshx/package.json', JSON.stringify({ name: '@dshfiles/dshx', exports: { '.': { default: './dist/index.js' } } }))
  for (const [name, dependencies, testSource] of [
    ['shared-streams', { '@dshfiles/dshx': 'workspace:*' }, "import { value } from './shim'\n"],
    ['prompt-stash', {}, "import { value } from '../dist/index.js'\n"],
    ['usage', {}, "import { value } from './command-identifiers'\n"],
    ['consumer', { '@dshfiles/usage': 'workspace:*' }, "import { value } from '@dshfiles/usage'\n"],
  ]) {
    const directory = `plugins/@dshfiles/${name}`
    write(`${directory}/package.json`, JSON.stringify({ name: `@dshfiles/${name}`, scripts: { test: 'vitest run' }, devDependencies: dependencies }))
    write(`${directory}/src/value.test.ts`, testSource)
  }
  const sourceOnly = 'plugins/@dshfiles/shared-streams/src/shim.ts'
  write(sourceOnly, 'export const value = 1\n')
  write('plugins/@dshfiles/prompt-stash/src/host.ts', 'export const value = 1\n')
  write('plugins/@dshfiles/usage/src/command-identifiers.ts', 'export const value = 1\n')
  return {
    sourceOnly,
    buildDependency: () => write('tooling/dshx/packages/dshx/dist/index.js', 'export {}\n'),
    dryRun: (path, ...args) =>
      JSON.parse(
        execFileSync(process.execPath, [join(root, 'scripts/test-selection.mjs'), 'related', path, '--dry-run', ...args], { cwd: root, encoding: 'utf8' }),
      ),
  }
}

test('default and explicit auto build respect cold and warm workspace dependencies', async t => {
  for (const args of [[], ['--build=auto']]) {
    await t.test(args[0] ?? 'default', t => {
      const fixture = buildFixture(t)
      const cold = fixture.dryRun(fixture.sourceOnly, ...args)
      assert.deepEqual(cold.packages, [{ name: '@dshfiles/shared-streams', mode: 'related', files: [fixture.sourceOnly] }])
      assert.deepEqual(cold.build, { required: true, reason: 'unbuilt workspace dependency @dshfiles/dshx' })

      // Add only the fixture dependency's declared export; never build or mutate this checkout.
      fixture.buildDependency()
      const warm = fixture.dryRun(fixture.sourceOnly, ...args)
      assert.deepEqual(warm.packages, cold.packages)
      assert.deepEqual(warm.build, { required: false, reason: 'related tests import source only' })
      assert.deepEqual(fixture.dryRun(fixture.sourceOnly, '--build=always').build, { required: true, reason: 'forced' })
    })
  }
})

test('auto build still builds dist loaders and full dependents with warm dependencies', t => {
  const fixture = buildFixture(t)
  fixture.buildDependency()
  const dryRunAutoBuild = path => fixture.dryRun(path, '--build=auto')
  assert.deepEqual(dryRunAutoBuild(fixture.sourceOnly).build, { required: false, reason: 'related tests import source only' })
  const distLoader = dryRunAutoBuild('plugins/@dshfiles/prompt-stash/src/host.ts')
  assert.deepEqual(distLoader.build, { required: true, reason: '@dshfiles/prompt-stash test loads dist: plugins/@dshfiles/prompt-stash/src/value.test.ts' })
  const dependentPath = 'plugins/@dshfiles/usage/src/command-identifiers.ts'
  const dependent = dryRunAutoBuild(dependentPath)
  assert.deepEqual(summarize(dependent.packages), [
    { name: '@dshfiles/usage', mode: 'related' },
    { name: '@dshfiles/consumer', mode: 'full' },
  ])
  assert.deepEqual(dependent.build, { required: true, reason: 'dependent tests load built packages' })
  assert.deepEqual(dependent.consumers, [{ name: '@dshfiles/consumer', tests: 1, files: ['src/value.test.ts'] }])
  assert.deepEqual(fixture.dryRun(dependentPath, '--build=auto', '--consumers=full').build, {
    required: true,
    reason: '@dshfiles/consumer runs its full suite',
  })
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
