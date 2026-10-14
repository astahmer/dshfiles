import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { cucumberExpressionPattern, featureOwner, featureSteps, parseStepDefinitions, planBrowserTasks } from './browser-tasks.mjs'

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
