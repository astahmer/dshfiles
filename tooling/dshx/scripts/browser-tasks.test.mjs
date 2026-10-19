import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  cucumberExpressionPattern,
  featureOwner,
  featureScenarios,
  featureSteps,
  impactOfBundle,
  parseStepDefinitions,
  planBrowserTasks,
  resolveBrowserSelection,
  runtimeDistDigest,
} from './browser-tasks.mjs'

const featuresDir = resolve(dirname(fileURLToPath(import.meta.url)), '../e2e/features')

test('a {string} parameter matches Gherkin strings with escaped quotes', () => {
  const pattern = cucumberExpressionPattern('the fake model is asked to {string}')
  assert.ok(pattern.test(String.raw`the fake model is asked to "[[call secret_get {\"alias\":\"DB\"}]]"`))
  assert.ok(!pattern.test('the fake model is asked to nothing'))
})

test('an escaped slash in a step expression is a literal slash', () => {
  const [definition] = parseStepDefinitions(String.raw`When('the \\/goto command is opened', async () => {})`)
  assert.ok(cucumberExpressionPattern(definition.expression).test('the /goto command is opened'))
})

test('step definitions split across lines are found with their bodies', () => {
  const definitions = parseStepDefinitions(`Given(\n  'the {string} profile is booted',\n  async () => bootProfile('web'),\n)\nThen('it passes', () => {})`)
  assert.deepEqual(
    definitions.map(definition => definition.expression),
    ['the {string} profile is booted', 'it passes'],
  )
  assert.match(definitions[0].body, /bootProfile/)
  assert.doesNotMatch(definitions[1].body, /bootProfile/)
})

test('a feature belongs to the package most of its scenario tags name, else to the plugins workspace', () => {
  const packages = new Set(['@dshfiles/settings-shell', '@dshfiles/editor'])
  const source = '@scenario:settings-shell.tab\n@scenario:editor.settings\n@scenario:settings-shell.dialog\nScenario: x'
  assert.equal(featureOwner(source, packages), '@dshfiles/settings-shell')
  assert.equal(featureOwner('Scenario: untagged', packages), 'dshfiles-plugins')
})

test('every feature file has one owner, every step resolves, and isolated journeys key on the bundles they boot', async () => {
  const { owners } = await planBrowserTasks()
  const featureNames = (await readdir(featuresDir)).filter(name => name.endsWith('.feature')).map(name => name.replace(/\.feature$/, ''))
  const owned = [...owners.values()].flatMap(owner => owner.features)
  assert.deepEqual([...owned].sort(), [...featureNames].sort())
  // An unmatched step still plans safely (every step file, every bundle) but reruns that package on any journey edit.
  assert.deepEqual(
    [...owners.values()].flatMap(owner => owner.unmatchedSteps),
    [],
  )
  const mcpServers = owners.get('@dshfiles/mcp-servers')
  assert.ok(mcpServers.booted.has('@dshfiles/thread-sidebar'), 'the @ autocomplete journey boots thread-sidebar beside mcp-servers')
  assert.ok(!mcpServers.booted.has('@dshfiles/workbench'))
  assert.ok(featureSteps(await readFile(resolve(featuresDir, 'mcp-servers.feature'), 'utf8')).length > 0)
})

test('tasks key on dist digests, never on a dist glob Turbo would drop inside the owning package', async () => {
  const { configs } = await planBrowserTasks()
  const inputs = configs.get('@dshfiles/mcp-servers').tasks['test:e2e'].inputs
  assert.ok(inputs.includes('$TURBO_ROOT$/.turbo/browser-dist/dshfiles__mcp-servers.sha256'))
  assert.ok(inputs.includes('$TURBO_ROOT$/.turbo/browser-dist/dshfiles__thread-sidebar.sha256'))
  const everyInput = [...configs.values()].flatMap(config => Object.values(config.tasks).flatMap(task => task.inputs))
  assert.deepEqual(
    everyInput.filter(input => input.includes('/dist/')),
    [],
  )
})

test('a dist digest moves with the runtime JavaScript, never with source maps or declarations', async t => {
  const dist = await mkdtemp(join(tmpdir(), 'browser-dist-'))
  t.after(() => rm(dist, { recursive: true, force: true }))
  await mkdir(join(dist, 'native'))
  const write = (file, text) => writeFile(join(dist, file), text)
  await write('client.js', 'export const answer = 42\n//# sourceMappingURL=client.js.map\n')
  await write('client.js.map', '{"version":3,"mappings":"AAAA"}')
  await write('client.d.ts', 'export declare const answer: number\n')
  await write('native/slots.d.ts.map', '{"version":3,"mappings":"AAAA"}')
  const built = await runtimeDistDigest(dist)

  await write('client.js.map', '{"version":3,"mappings":"AAAA;AACA"}')
  await write('native/slots.d.ts.map', '{"version":3,"mappings":"AACA"}')
  await write('client.d.ts', 'export declare const answer: 42\n')
  assert.equal(await runtimeDistDigest(dist), built)

  await write('client.js', 'export const answer = 43\n//# sourceMappingURL=client.js.map\n')
  assert.notEqual(await runtimeDistDigest(dist), built)
})

test('a scoped browser run builds and digests only its own boot closure', async () => {
  const scoped = await resolveBrowserSelection({ names: ['agent-communication'], mode: 'e2e' })
  assert.deepEqual(scoped.filters, ['--filter=@dshfiles/agent-communication'])
  assert.ok(scoped.buildTargets !== undefined)
  assert.ok(scoped.buildTargets.includes('@dshfiles/agent-communication'))
  assert.ok(scoped.buildTargets.includes('@dshfiles/dshx'))
  assert.ok(!scoped.buildTargets.includes('@dshfiles/jujutsu'))
  assert.ok(!scoped.buildTargets.includes('@dshfiles/ai-accounts'))
  assert.ok(scoped.buildTargets.length < 20)
})

test('a feature file name resolves to the owner package, a boot run to the named bundle', async () => {
  const byFeature = await resolveBrowserSelection({ names: ['thread-view-presets'], mode: 'e2e' })
  assert.deepEqual(byFeature.filters, ['--filter=@dshfiles/thread-sidebar'])
  assert.ok(byFeature.buildTargets.includes('@dshfiles/thread-sidebar'))

  const boot = await resolveBrowserSelection({ names: ['agent-communication'], mode: 'boot' })
  assert.deepEqual(boot.filters, ['--filter=@dshfiles/agent-communication'])
  assert.ok(boot.buildTargets.includes('@dshfiles/dshx'))
})

test('a broad invocation keeps every owned bundle and no scoped target list', async () => {
  const broad = await resolveBrowserSelection({ names: [], mode: 'e2e' })
  assert.equal(broad.buildTargets, undefined)
  assert.deepEqual(broad.filters, ['--filter=./plugins', '--filter=./plugins/@dshfiles/*'])
})

test('every owner closure stays scoped to the packages its own boot reads', async () => {
  const { owners, closures } = await planBrowserTasks()
  for (const owner of owners.values()) {
    const closure = closures.get(owner.name)
    assert.ok(closure !== undefined, `${owner.name} has no closure`)
    // An owner that boots one bundle must not drag in every owned bundle, and every seeded bundling package stays in.
    for (const booted of owner.booted) assert.ok(closure.includes(booted), `${owner.name} closure omits ${booted}`)
    assert.ok(closure.includes('@dshfiles/dshx'))
  }
})

test('featureScenarios keeps each scenario with its own id and steps', () => {
  const scenarios = featureScenarios(
    [
      'Feature: Example',
      '',
      '  @smoke',
      '  @scenario:example.first',
      '  Scenario: First behaviour',
      '    Given the isolated plugin profile "@dshfiles/alpha" is booted',
      '    Then it works',
      '',
      '  @scenario:example.second',
      '  Scenario: Second behaviour',
      '    Given the isolated plugin profile "@dshfiles/beta" is booted',
      '    Then it also works',
    ].join('\n'),
  )
  assert.deepEqual(
    scenarios.map(scenario => scenario.id),
    ['example.first', 'example.second'],
  )
  assert.deepEqual(scenarios[0]?.steps, ['the isolated plugin profile "@dshfiles/alpha" is booted', 'it works'])
  assert.equal(scenarios[1]?.title, 'Second behaviour')
})

test('impactOfBundle names the scenarios whose own steps reach a bundle, not their whole task', () => {
  const owners = new Map([
    [
      '@dshfiles/alpha',
      {
        name: '@dshfiles/alpha',
        scenarios: [
          { id: 'alpha.one', feature: 'alpha', booted: ['@dshfiles/alpha'], everyBundle: false },
          { id: 'alpha.two', feature: 'alpha', booted: ['@dshfiles/beta'], everyBundle: false },
          { id: 'alpha.all', feature: 'alpha', booted: [], everyBundle: true },
        ],
      },
    ],
  ])
  assert.deepEqual(
    impactOfBundle(owners, '@dshfiles/alpha').map(scenario => scenario.id),
    ['alpha.one', 'alpha.all'],
  )
  assert.deepEqual(
    impactOfBundle(owners, '@dshfiles/beta').map(scenario => scenario.id),
    ['alpha.two', 'alpha.all'],
  )
})

test('a scenario-level impact is never wider than the task-level impact it replaces', async () => {
  const { owners } = await planBrowserTasks()
  const total = [...owners.values()].reduce((sum, owner) => sum + owner.scenarios.length, 0)
  assert.ok(total >= 190, `every scenario should be planned, saw ${String(total)}`)
  const affected = impactOfBundle(owners, '@dshfiles/command-palette')
  const affectedOwners = new Set(affected.map(scenario => scenario.owner))
  // command-palette reaches far fewer scenarios than the task count its digest already fans out to.
  assert.ok(affected.length > 0 && affected.length < 60, `expected a handful of scenarios, saw ${String(affected.length)}`)
  assert.ok(affectedOwners.size < owners.size)
})
