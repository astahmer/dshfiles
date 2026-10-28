import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
  scenarioRecipeHash,
} from './browser-tasks.mjs'

const featuresDir = resolve(dirname(fileURLToPath(import.meta.url)), '../e2e/features')

test('AI Accounts browser tasks include their inert auth fixture without widening unrelated owners', async () => {
  const { configs } = await planBrowserTasks()
  const fixture = '$TURBO_ROOT$/plugins/@dshfiles/ai-accounts/src/inert-codex-login.fixture.ts'
  assert.ok(configs.get('@dshfiles/ai-accounts').tasks['test:e2e'].inputs.includes(fixture))
  assert.ok(!configs.get('@dshfiles/editor').tasks['test:e2e'].inputs.includes(fixture))
})

test('scenario recipe hashes include shared and fixture content with deterministic source ordering', () => {
  const recipe = {
    steps: ['setup'],
    definitions: [{ file: 'recipe.steps.ts', expression: 'setup', body: 'connect()' }],
    sharedSources: [
      ['boot.ts', 'seed-v1'],
      ['hooks.ts', 'hooks-v1'],
    ],
    fixtureSources: [
      ['profile-sync.ts', 'fixture-v1'],
      ['profile-seed.ts', 'seed-v1'],
    ],
  }
  const key = scenarioRecipeHash(recipe)
  assert.equal(key, scenarioRecipeHash(recipe))
  assert.equal(key, scenarioRecipeHash({ ...recipe, sharedSources: [...recipe.sharedSources].reverse(), fixtureSources: [...recipe.fixtureSources].reverse() }))
  assert.notEqual(key, scenarioRecipeHash({ ...recipe, sharedSources: [['boot.ts', 'seed-v2'], recipe.sharedSources[1]] }))
  assert.notEqual(key, scenarioRecipeHash({ ...recipe, fixtureSources: [['profile-sync.ts', 'fixture-v2'], recipe.fixtureSources[1]] }))
  assert.notEqual(key, scenarioRecipeHash({ ...recipe, fixtureSources: [['renamed.ts', 'fixture-v1'], recipe.fixtureSources[1]] }))
  assert.notEqual(key, scenarioRecipeHash({ ...recipe, sharedSources: recipe.sharedSources.slice(1) }))
})

test('the planner hashes real shared recipes and keeps fixture changes isolated to their owner', async t => {
  const root = await mkdtemp(join(tmpdir(), 'browser-recipes-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const write = async (file, source) => {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), source)
  }
  const planner = 'tooling/dshx/scripts/browser-tasks.mjs'
  await mkdir(dirname(join(root, planner)), { recursive: true })
  await copyFile(fileURLToPath(new URL('./browser-tasks.mjs', import.meta.url)), join(root, planner))
  for (const name of ['multi-host', 'editor']) {
    await write(`plugins/@dshfiles/${name}/package.json`, JSON.stringify({ name: `@dshfiles/${name}`, dsh: {} }))
    await write(
      `tooling/dshx/e2e/features/${name}.feature`,
      `Feature: ${name}\n  @smoke\n  @scenario:${name}.recipe\n  Scenario: Recipe\n    Given the isolated plugin profile "@dshfiles/${name}" is booted\n`,
    )
  }
  await write('tooling/dshx/packages/dshx/package.json', JSON.stringify({ name: '@dshfiles/dshx' }))
  await write('tooling/dshx/e2e/support/plugin-journeys/recipe.steps.ts', "Given('the isolated plugin profile {string} is booted', async () => {})")
  const boot = 'tooling/dshx/e2e/support/boot.ts'
  const fixture = 'scripts/profile-sync.ts'
  await write(boot, 'export const seed = "v1"\n')
  await write(fixture, 'export const reconcile = "v1"\n')
  const { planBrowserTasks: planFixture } = await import(pathToFileURL(join(root, planner)).href)
  const initial = await planFixture()
  const hash = (plan, owner) => plan.owners.get(`@dshfiles/${owner}`).scenarios[0].stepsHash
  assert.equal(hash(await planFixture(), 'multi-host'), hash(initial, 'multi-host'))
  for (const task of ['test:e2e', 'test:e2e:smoke']) {
    assert.ok(initial.configs.get('@dshfiles/multi-host').tasks[task].inputs.includes(`$TURBO_ROOT$/${fixture}`))
    assert.ok(!initial.configs.get('@dshfiles/editor').tasks[task].inputs.includes(`$TURBO_ROOT$/${fixture}`))
  }
  assert.ok(!initial.configs.get('@dshfiles/multi-host').tasks['test:boot'].inputs.includes(`$TURBO_ROOT$/${fixture}`))

  await write(fixture, 'export const reconcile = "v2"\n')
  const changedFixture = await planFixture()
  assert.notEqual(hash(changedFixture, 'multi-host'), hash(initial, 'multi-host'))
  assert.equal(hash(changedFixture, 'editor'), hash(initial, 'editor'))

  await write(boot, 'export const seed = "v2"\n')
  const changedBoot = await planFixture()
  for (const owner of ['multi-host', 'editor']) assert.notEqual(hash(changedBoot, owner), hash(changedFixture, owner))

  await write(boot, 'export const seed = "v1"\n')
  await write(fixture, 'export const reconcile = "v1"\n')
  const restored = await planFixture()
  for (const owner of ['multi-host', 'editor']) assert.equal(hash(restored, owner), hash(initial, owner))
})

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

test('a scenario key moves when a step implementation changes, not only its text', () => {
  const recipe = {
    steps: ['setup'],
    definitions: [{ file: 'recipe.steps.ts', expression: 'setup', body: 'connect()' }],
    sharedSources: [],
    fixtureSources: [],
  }
  const key = scenarioRecipeHash(recipe)
  assert.notEqual(key, scenarioRecipeHash({ ...recipe, steps: ['other setup'] }))
  for (const change of [{ file: 'renamed.steps.ts' }, { expression: 'other setup' }, { body: 'reconnect()' }]) {
    assert.notEqual(key, scenarioRecipeHash({ ...recipe, definitions: [{ ...recipe.definitions[0], ...change }] }))
  }
})
