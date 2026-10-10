import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'feature-coverage.mjs')
const temporaryRoots = []

const withFixture = async callback => {
  const root = await mkdtemp(resolve(tmpdir(), 'dshx-feature-coverage-'))
  temporaryRoots.push(root)
  const pluginRoot = resolve(root, 'plugins/@dshfiles/demo')
  const featureRoot = resolve(root, 'tooling/dshx/e2e/features')
  await mkdir(pluginRoot, { recursive: true })
  await mkdir(featureRoot, { recursive: true })
  await writeFile(resolve(pluginRoot, 'package.json'), JSON.stringify({ name: '@dshfiles/demo', dsh: { client: {} }, dshx: { features: './dshx.features.json' } }))
  await writeFile(
    resolve(pluginRoot, 'dshx.features.json'),
    JSON.stringify({
      schemaVersion: 1,
      kind: 'bundle',
      features: [
        {
          id: 'boot-profile',
          title: 'Boot a disposable profile',
          summary: 'Start a temporary profile with this bundle enabled.',
          surfaces: ['host'],
          configuration: [
            { key: 'timeoutMs', defaultValue: '30000', constraints: 'Positive integer milliseconds.', coveredBy: ['demo.boot-profile'] },
          ],
          states: ['starting', 'ready', 'failed'],
          failureModes: ['The Host fails before publishing the bundle.'],
          externalDependencies: [],
          verification: [
            { kind: 'gherkin', id: 'demo.boot-profile', featureFile: 'tooling/dshx/e2e/features/demo.feature' },
          ],
        },
      ],
    }),
  )
  const featureFile = resolve(featureRoot, 'demo.feature')
  await writeFile(featureFile, '@scenario:demo.boot-profile\nFeature: Demo boot\n  Scenario: Boot the disposable profile\n')
  return callback({ root, featureFile })
}

const runCheck = (root, mode = '--check') =>
  spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, mode, '--root', root], { encoding: 'utf8' })

test.after(async () => {
  await Promise.all(temporaryRoots.map(root => rm(root, { recursive: true, force: true })))
})

test('checks package metadata against scenario tags and generates a compact report', async () => {
  await withFixture(async ({ root }) => {
    const check = runCheck(root)
    assert.equal(check.status, 0, check.stderr)
    assert.match(check.stdout, /1 package catalogs, 1 features, 1 configuration options, 1 Gherkin scenarios/)

    const report = runCheck(root, '--report')
    assert.equal(report.status, 0, report.stderr)
    assert.match(report.stdout, /demo\.boot-profile/)
    assert.match(report.stdout, /timeoutMs/)
  })
})

test('rejects orphan and missing scenario tags instead of silently reducing coverage', async () => {
  await withFixture(async ({ root, featureFile }) => {
    await writeFile(featureFile, '@scenario:demo.unknown\nFeature: Demo\n  Scenario: Unowned\n')
    const result = runCheck(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Declared Gherkin scenario demo\.boot-profile has no @scenario tag/)
    assert.match(result.stderr, /Orphan @scenario:demo\.unknown tag/)
  })
})
