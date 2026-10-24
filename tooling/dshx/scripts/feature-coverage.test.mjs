import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
  await writeFile(
    resolve(pluginRoot, 'package.json'),
    JSON.stringify({ name: '@dshfiles/demo', dsh: { client: {} }, dshx: { features: './dshx.features.json' } }),
  )
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
          configuration: [{ key: 'timeoutMs', defaultValue: '30000', constraints: 'Positive integer milliseconds.', coveredBy: ['demo.boot-profile'] }],
          states: ['starting', 'ready', 'failed'],
          failureModes: ['The Host fails before publishing the bundle.'],
          externalDependencies: [],
          verification: [{ kind: 'gherkin', id: 'demo.boot-profile', featureFile: 'tooling/dshx/e2e/features/demo.feature' }],
          telemetry: [{ kind: 'automatic', source: 'api-dispatch' }],
        },
      ],
    }),
  )
  await mkdir(resolve(pluginRoot, 'src'), { recursive: true })
  await writeFile(resolve(pluginRoot, 'dshx.config.ts'), "export default defineConfig({ name: '@dshfiles/demo', host: { entry: 'src/host.ts' } })\n")
  await writeFile(resolve(pluginRoot, 'src/host.ts'), "import { demoApi } from './api.js'\nexport const host = demoApi\n")
  await writeFile(resolve(pluginRoot, 'src/api.ts'), "export const demoApi = defineApi({ id: 'demo' })\n")
  const featureFile = resolve(featureRoot, 'demo.feature')
  await writeFile(featureFile, 'Feature: Demo boot\n  @scenario:demo.boot-profile\n  Scenario: Boot the disposable profile\n')
  return callback({ root, pluginRoot, featureFile, catalogFile: resolve(pluginRoot, 'dshx.features.json') })
}

const runCheck = (root, mode = '--check') => spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, mode, '--root', root], { encoding: 'utf8' })

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
    await writeFile(featureFile, 'Feature: Demo\n  @scenario:demo.unknown\n  Scenario: Unowned\n')
    const result = runCheck(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Declared Gherkin scenario demo\.boot-profile has no @scenario tag/)
    assert.match(result.stderr, /Orphan @scenario:demo\.unknown tag/)
  })
})

test('rejects scenario tags attached to a Feature instead of a Scenario', async () => {
  await withFixture(async ({ root, featureFile }) => {
    await writeFile(featureFile, '@scenario:demo.boot-profile\nFeature: Demo boot\n  Scenario: Boot the disposable profile\n')
    const result = runCheck(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Declared Gherkin scenario demo\.boot-profile has no @scenario tag/)
    assert.match(
      result.stderr,
      /Misplaced @scenario:demo\.boot-profile tag in tooling\/dshx\/e2e\/features\/demo\.feature:1; scenario tags must annotate a Scenario or Scenario Outline/,
    )
  })
})

test('accepts scenario tags on a Scenario Outline', async () => {
  await withFixture(async ({ root, featureFile }) => {
    await writeFile(
      featureFile,
      'Feature: Demo boot\n  @scenario:demo.boot-profile\n  Scenario Outline: Boot a <profile> profile\n    Given the disposable profile is <profile>\n    Examples:\n      | profile |\n      | demo    |\n',
    )
    const result = runCheck(root)
    assert.equal(result.status, 0, result.stderr)
  })
})

test('reports a missing Gherkin file separately from a missing scenario tag', async () => {
  await withFixture(async ({ root, featureFile }) => {
    await rm(featureFile)
    const result = runCheck(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Declared Gherkin feature file tooling\/dshx\/e2e\/features\/demo\.feature is missing from E2E feature discovery/)
  })
})

test('lets a bundle feature declare its missing browser journey only with an explicit rationale', async () => {
  await withFixture(async ({ root, featureFile, catalogFile }) => {
    await rm(featureFile)
    const catalog = JSON.parse(await readFile(catalogFile, 'utf8'))
    catalog.features[0].verification = [{ kind: 'unit-test', id: 'demo.boot-unit', file: 'plugins/@dshfiles/demo/package.json', testName: '@dshfiles/demo' }]
    catalog.features[0].configuration[0].coveredBy = ['demo.boot-unit']
    await writeFile(catalogFile, JSON.stringify(catalog))
    const withoutRationale = runCheck(root)
    assert.equal(withoutRationale.status, 1)
    assert.match(withoutRationale.stderr, /bundle feature boot-profile needs a Gherkin browser scenario or an explicit not-applicable rationale/)

    catalog.features[0].verification.push({ kind: 'not-applicable', id: 'demo.boot-browser', reason: 'No browser journey exists yet for booting the profile.' })
    await writeFile(catalogFile, JSON.stringify(catalog))
    const withRationale = runCheck(root)
    assert.equal(withRationale.status, 0, withRationale.stderr)
  })
})

const editCatalog = async (catalogFile, change) => {
  const catalog = JSON.parse(await readFile(catalogFile, 'utf8'))
  change(catalog)
  await writeFile(catalogFile, JSON.stringify(catalog))
}

const spanTest = (body = "using recorder = recordSpans()\n    await run()\n    expect(recorder.span('demo sync').attributes).toBeDefined()") =>
  `import { recordSpans } from '@dshfiles/dshx/tracing'\n\ntest('records the demo sync span', async () => {\n    ${body}\n})\n\ntest('another test', () => {})\n`

const customEntry = { kind: 'custom', span: 'demo sync', file: 'plugins/@dshfiles/demo/src/sync.test.ts', testName: 'records the demo sync span' }

test('requires a telemetry entry on every feature', async () => {
  await withFixture(async ({ root, catalogFile }) => {
    await editCatalog(catalogFile, catalog => {
      delete catalog.features[0].telemetry
    })
    const result = runCheck(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /features\.0\.telemetry/)
  })
})

test('rejects an automatic source the package code does not back', async () => {
  await withFixture(async ({ root, catalogFile }) => {
    await editCatalog(catalogFile, catalog => {
      catalog.features[0].telemetry = [{ kind: 'automatic', source: 'model-stream' }]
    })
    const result = runCheck(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /feature boot-profile telemetry model-stream needs a ctx\.llm stream/)
  })
})

test('requires agent-tool on a tool surface', async () => {
  await withFixture(async ({ root, catalogFile }) => {
    await editCatalog(catalogFile, catalog => {
      catalog.features[0].surfaces = ['host', 'tool']
      catalog.features[0].telemetry = [{ kind: 'not-applicable', reason: 'Nothing worth tracing happens in this feature.' }]
    })
    const result = runCheck(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /a tool surface emits execute_tool spans/)

    await editCatalog(catalogFile, catalog => {
      catalog.features[0].surfaces = ['host']
    })
    assert.equal(runCheck(root).status, 0, runCheck(root).stderr)
  })
})

test('checks a custom span against the Host source and a recordSpans test that names it', async () => {
  await withFixture(async ({ root, pluginRoot, catalogFile }) => {
    await editCatalog(catalogFile, catalog => {
      catalog.features[0].telemetry = [customEntry]
    })
    const missing = runCheck(root)
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /span "demo sync" is not emitted by any Host source string/)
    assert.match(missing.stderr, /telemetry test file plugins\/@dshfiles\/demo\/src\/sync\.test\.ts does not exist/)

    await writeFile(
      resolve(pluginRoot, 'src/host.ts'),
      "import { withSpan } from '@dshfiles/dshx/tracing'\nexport const run = () => withSpan('demo sync', {}, async () => 1)\n",
    )
    await writeFile(resolve(pluginRoot, 'src/sync.test.ts'), spanTest('await run()'))
    const unrecorded = runCheck(root)
    assert.equal(unrecorded.status, 1)
    assert.match(unrecorded.stderr, /telemetry test records the demo sync span must call recordSpans\(\)/)
    assert.match(unrecorded.stderr, /never names span "demo sync"/)

    await writeFile(resolve(pluginRoot, 'src/sync.test.ts'), spanTest())
    const recorded = runCheck(root)
    assert.equal(recorded.status, 0, recorded.stderr)
    assert.match(recorded.stdout, /telemetry \(0 automatic, 1 custom span entries, 0 not applicable\)/)

    await editCatalog(catalogFile, catalog => {
      catalog.features[0].telemetry = [{ ...customEntry, testName: 'records a renamed span' }]
    })
    assert.match(runCheck(root).stderr, /telemetry test records a renamed span was not found/)
  })
})

test('matches a dynamic span name against a template literal and a concrete test assertion', async () => {
  await withFixture(async ({ root, pluginRoot, catalogFile }) => {
    await writeFile(
      resolve(pluginRoot, 'src/host.ts'),
      'import { withSpan } from "@dshfiles/dshx/tracing"\nexport const run = (verb) => withSpan(`demo ${verb}`, {}, async () => 1)\n',
    )
    await writeFile(resolve(pluginRoot, 'src/sync.test.ts'), spanTest())
    await editCatalog(catalogFile, catalog => {
      catalog.features[0].telemetry = [{ ...customEntry, span: 'demo <verb>' }]
    })
    const result = runCheck(root)
    assert.equal(result.status, 0, result.stderr)
  })
})

test('fails Host I/O without a span until it opens one or names its delegation', async () => {
  await withFixture(async ({ root, pluginRoot, catalogFile }) => {
    await writeFile(resolve(pluginRoot, 'src/host.ts'), "import { demoApi } from './api.js'\nimport './network.js'\nexport const host = demoApi\n")
    await writeFile(resolve(pluginRoot, 'src/network.ts'), "export const load = () => fetch('https://example.invalid')\n")
    await writeFile(resolve(pluginRoot, 'src/client-only.ts'), "export const load = () => fetch('/browser')\n")
    const untraced = runCheck(root)
    assert.equal(untraced.status, 1)
    assert.match(untraced.stderr, /Host file src\/network\.ts does I\/O \(fetch\) without a span/)
    assert.doesNotMatch(untraced.stderr, /client-only/)

    await editCatalog(catalogFile, catalog => {
      catalog.ioDelegation = [{ file: 'src/network.ts', tracedBy: 'demo sync', reason: 'The caller opens the demo sync span around every request.' }]
    })
    assert.match(runCheck(root).stderr, /tracedBy "demo sync" is not a custom span declared by this catalog/)

    await editCatalog(catalogFile, catalog => {
      catalog.ioDelegation = [{ file: 'src/network.ts', reason: 'The caller opens the demo sync span around every request.' }]
    })
    assert.equal(runCheck(root).status, 0, runCheck(root).stderr)

    await writeFile(
      resolve(pluginRoot, 'src/network.ts'),
      "import { withSpan } from '@dshfiles/dshx/tracing'\nexport const load = () => withSpan('demo load', {}, () => fetch('https://example.invalid'))\n",
    )
    assert.match(runCheck(root).stderr, /ioDelegation src\/network\.ts opens its own span; remove the entry/)
  })
})

test('ignores type-only Node network imports', async () => {
  await withFixture(async ({ root, pluginRoot }) => {
    await writeFile(
      resolve(pluginRoot, 'src/host.ts'),
      "import type { ServerResponse } from 'node:http'\nimport { demoApi } from './api.js'\nexport const host = demoApi\n",
    )
    assert.equal(runCheck(root).status, 0, runCheck(root).stderr)
  })
})
