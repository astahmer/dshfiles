import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { PresetMigration } from './presets.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = readFileSync(join(HERE, 'fixtures', 'preset-0.2.1.patch.yml'), 'utf8')
const NEW = '0.2.2-rc.2'
const OLD = '0.2.1-rc.2'

const STOCK = [
  'dsh-persona',
  'dsh-agent-instructions',
  'dsh-tool-bash',
  'dsh-tool-fs',
  'dsh-tool-fs-search',
  'dsh-tool-todo',
  'dsh-tool-subagent-control',
  'dsh-tool-subagent',
  'dsh-tool-executor-ptc',
  'dsh-tool-executor-native',
  'dsh-agent-tool-presentation',
]

const writePackage = (directory, manifest) => {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module', exports: { '.': './index.js' }, ...manifest }))
  writeFileSync(join(directory, 'index.js'), 'export default {}\n')
}

/** A core install tree resolved the way the Loader resolves it: real files, real `exports`. */
const fakeWorld = ({ version = NEW, packages = {} } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-presets-test-'))
  const core = join(root, 'core')
  const modules = join(core, 'node_modules')
  writePackage(join(modules, '@deepseek-ai', 'dsh'), { name: '@deepseek-ai/dsh', version })
  writePackage(join(modules, '@deepseek-ai', 'cordis'), { name: '@deepseek-ai/cordis', version: '4.1.0' })
  for (const name of STOCK) writePackage(join(modules, '@deepseek-ai', name), { name: `@deepseek-ai/${name}`, version })
  for (const [name, manifest] of Object.entries(packages)) writePackage(join(modules, name), { name, version: '1.0.0', ...manifest })
  const home = join(root, 'home')
  const profile = join(home, 'profiles', 'web')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }))
  return { root, core, home, profile, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

const withWorld = (options, patch, run) => {
  const world = fakeWorld(options)
  try {
    writeFileSync(join(world.profile, 'cordis.patch.yml'), patch)
    return run(world)
  } finally {
    world.cleanup()
  }
}

const plan = (world, from = OLD) => PresetMigration.plan({ profileDir: world.profile, coreRoot: world.core, from, home: world.home })

const preset = rows => `- insert:
    - id: preset-mine
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: mine
        plugins:
${rows}`

test('migrates a 0.2.1 custom preset with only the two broken lines changed', () => {
  withWorld({}, FIXTURE, world => {
    const result = plan(world)
    assert.deepEqual(result.errors, [])
    assert.deepEqual(
      result.changes.map(change => change.rule),
      ['list-agents-merged', 'subagent-model-selection-split'],
    )
    assert.deepEqual(result.presets, [{ id: 'reviewer', selectedBy: ['registry default'] }])
    const expected = FIXTURE.replace(
      "              - id: tool-subagent-list-agents\n                name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'\n",
      '',
    ).replace('                  modelSelectionSettings: true\n', '                  modelSelection: true\n                  modelDiscovery: true\n')
    assert.notEqual(expected, FIXTURE)
    assert.equal(result.sources[0].migrated, expected)

    const written = PresetMigration.write(result)
    assert.equal(written.length, 1)
    assert.equal(readFileSync(written[0].backup, 'utf8'), FIXTURE)
    assert.equal(readFileSync(join(world.profile, 'cordis.patch.yml'), 'utf8'), expected)
    // Custom settings, comments and !!js expressions are byte-for-byte where they were.
    for (const kept of [
      'meticulous code reviewer',
      'maxBytes: 32768',
      'sampleOverCapGlobResults: true',
      'allowParallelInProgress: false',
      "!!js process.platform === 'win32'",
      '# Custom wording',
    ]) {
      assert.ok(expected.includes(kept), kept)
    }

    const again = plan(world)
    assert.deepEqual(again.changes, [])
    assert.deepEqual(again.errors, [])
  })
})

test('renames list-agents to tool-subagent-control when the preset lacks it', () => {
  const rows = `          - id: list
            name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'
          - id: fs
            name: '@deepseek-ai/dsh-tool-fs'
`
  withWorld({}, preset(rows), world => {
    const result = plan(world)
    assert.deepEqual(result.errors, [])
    assert.equal(
      result.sources[0].migrated,
      preset(`          - id: list
            name: '@deepseek-ai/dsh-tool-subagent-control'
            config:
              interrupt: false
          - id: fs
            name: '@deepseek-ai/dsh-tool-fs'
`),
    )
    assert.match(result.changes[0].change, /also adds send_message/)
  })
})

test('replaces the deprecated tool-presentation mode by its executor and keeps other options', () => {
  const rows = `          - id: ptc
            name: '@deepseek-ai/dsh-agent-tool-presentation'
            config:
              mode: ptc
          - id: native
            name: '@deepseek-ai/dsh-agent-tool-presentation'
            config:
              mode: native
              note: kept
`
  withWorld({}, preset(rows), world => {
    const result = plan(world)
    assert.deepEqual(result.errors, [])
    assert.equal(
      result.sources[0].migrated,
      preset(`          - id: ptc
            name: '@deepseek-ai/dsh-tool-executor-ptc'
          - id: native
            name: '@deepseek-ai/dsh-tool-executor-native'
            config:
              note: kept
`),
    )
  })
})

test('an unknown invalid reference is an actionable error and nothing is written', () => {
  const rows = `          - id: gone
            name: '@acme/dsh-tool-gone'
          - id: list
            name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'
`
  withWorld({}, preset(rows), world => {
    const result = plan(world)
    assert.equal(result.errors.length, 1)
    const [error] = result.errors
    assert.equal(error.preset, 'mine')
    assert.equal(error.specifier, '@acme/dsh-tool-gone')
    assert.match(error.message, /preset "mine" \(.*cordis\.patch\.yml, \[0\]\.insert\[0\]\.config\.plugins\[0\], row gone \(@acme\/dsh-tool-gone\)\)/)
    assert.match(error.message, /does not resolve against dsh 0\.2\.2-rc\.2/)
    assert.match(error.message, /dsh plugin --profile <name> add @acme\/dsh-tool-gone|remove the row/)
    const before = readFileSync(join(world.profile, 'cordis.patch.yml'), 'utf8')
    assert.throws(() => PresetMigration.write(result), /unresolved error/)
    assert.equal(readFileSync(join(world.profile, 'cordis.patch.yml'), 'utf8'), before)
    assert.deepEqual(
      readdirSync(world.profile).filter(name => name.includes('before-presets')),
      [],
    )
  })
})

test('reports official modules from another core and engine ranges that exclude the core', () => {
  const rows = `          - id: old
            name: '@deepseek-ai/dsh-tool-old'
          - id: picky
            name: picky-tool
`
  const packages = {
    '@deepseek-ai/dsh-tool-old': { version: OLD },
    'picky-tool': { engines: { dsh: '>=0.3.0' } },
  }
  withWorld({ packages }, preset(rows), world => {
    const messages = plan(world).errors.map(error => error.message)
    assert.equal(messages.length, 2)
    assert.match(messages[0], /official modules must match the core version/)
    assert.match(messages[1], /engines\.dsh >=0\.3\.0, which excludes 0\.2\.2-rc\.2/)
  })
})

test('a literally disabled row that does not resolve is a warning, not an error', () => {
  const rows = `          - id: market
            name: '@deepseek-ai/dsh-plugin-market/tools'
            disabled: true
`
  withWorld({}, preset(rows), world => {
    const result = plan(world)
    assert.deepEqual(result.errors, [])
    assert.equal(result.warnings.length, 1)
  })
})

test('does not apply a rule the upgrade does not cross', () => {
  const rows = `          - id: list
            name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'
`
  withWorld({}, preset(rows), world => {
    const result = plan(world, '0.2.2-rc.1')
    assert.deepEqual(result.changes, [])
    assert.equal(result.errors.length, 1, 'the stale row is still reported as unresolvable')
  })
})

test('a linked bundle that needs migration is an error naming its source file', () => {
  withWorld({}, '[]\n', world => {
    const bundle = join(world.root, 'checkout', 'my-bundle')
    mkdirSync(bundle, { recursive: true })
    writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'my-bundle', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    writeFileSync(join(bundle, 'cordis.patch.yml'), preset(`          - id: list\n            name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'\n`))
    mkdirSync(join(world.profile, 'node_modules'), { recursive: true })
    symlinkSync(bundle, join(world.profile, 'node_modules', 'my-bundle'))
    writeFileSync(join(world.profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['my-bundle'] } } }))
    const result = plan(world)
    assert.equal(result.changes.length, 1)
    assert.ok(result.errors.some(error => /bundle my-bundle is a linked checkout/.test(error.message)))
  })
})

test('finds overrides of shipped presets and every selection source', () => {
  const patch = `- id: agent-preset-registry
  config:
    default: standard
    selectedDefault: mine
- id: preset-standard
  config:
    id: standard
    plugins:
      - id: fs
        name: '@deepseek-ai/dsh-tool-fs'
${preset(`          - id: fs\n            name: '@deepseek-ai/dsh-tool-fs'\n`)}`
  withWorld({}, patch, world => {
    mkdirSync(join(world.home, 'storages'), { recursive: true })
    writeFileSync(
      join(world.home, 'storages', 'agents.json'),
      JSON.stringify([{ name: 'agents' }, null, { agents: { luna: { handle: 'luna', preset: 'mine' } } }]),
    )
    const result = plan(world)
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.presets, [
      { id: 'standard', selectedBy: ['registry default'] },
      { id: 'mine', selectedBy: ['saved default', 'agent @luna'] },
    ])
    assert.deepEqual(PresetMigration.savedIds({ profileDir: world.profile, home: world.home }), { saved: ['standard', 'mine'], selected: ['standard', 'mine'] })
  })
})

test('an older restatement replaced by a later row with the same id is reported, never migrated or validated', () => {
  const row = child => `- id: preset-standard\n  name: '@deepseek-ai/dsh-agent-preset'\n  config:\n    id: standard\n    plugins:\n${child}`
  const stale = row(`      - id: list\n        name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'\n`)
  const current = row(`      - id: fs\n        name: '@deepseek-ai/dsh-tool-fs'\n`)
  withWorld({}, `${stale}# BEGIN NIX-MANAGED DSH PLUGINS\n${current}# END NIX-MANAGED DSH PLUGINS\n`, world => {
    const result = plan(world)
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.changes, [])
    assert.equal(result.sources[0].migrated, undefined)
    assert.equal(result.warnings.length, 1)
    assert.match(result.warnings[0].message, /\[0\]: row preset-standard is replaced by a later row .* \[1\] and never runs/)
  })
})
