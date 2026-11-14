import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { Preflight } from './preflight.mjs'

const FIXTURE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'preset-0.2.1.patch.yml'), 'utf8')
const STOCK = [
  'dsh-persona',
  'dsh-agent-instructions',
  'dsh-tool-bash',
  'dsh-tool-fs',
  'dsh-tool-fs-search',
  'dsh-tool-todo',
  'dsh-tool-subagent-control',
  'dsh-tool-subagent',
]

const writePackage = (directory, manifest, files = { 'index.js': 'export default {}\n' }) => {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module', exports: { '.': './index.js' }, ...manifest }))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, name)), { recursive: true })
    writeFileSync(join(directory, name), text)
  }
}

/** A fake core: its `--dump-config` prints `FAKE_DUMP_STDERR` and exits `FAKE_DUMP_EXIT`, as a real core reports a composition. */
const fakeCore = (root, version, { node = '>=18' } = {}) => {
  const modules = join(root, 'node_modules')
  const bin = `if (process.argv.includes('--dump-config')) { process.stderr.write(process.env.FAKE_DUMP_STDERR ?? ''); process.exit(Number(process.env.FAKE_DUMP_EXIT ?? 0)) }\n`
  writePackage(join(modules, '@deepseek-ai', 'dsh'), { name: '@deepseek-ai/dsh', version, engines: { node } }, { 'lib/bin.js': bin, 'index.js': '' })
  writePackage(join(modules, '@deepseek-ai', 'cordis'), { name: '@deepseek-ai/cordis', version: '4.1.0' })
  for (const name of STOCK) writePackage(join(modules, '@deepseek-ai', name), { name: `@deepseek-ai/${name}`, version })
  return join(modules, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

const world = t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-preflight-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const sourceRoot = join(root, 'checkout')
  mkdirSync(sourceRoot, { recursive: true })
  writeFileSync(join(sourceRoot, '.node-version'), '24.11.1\n')
  const checkoutEntry = fakeCore(sourceRoot, '0.2.2-rc.2')
  const dshHome = join(root, 'home')
  const profileDir = join(dshHome, 'profiles', 'manuel')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  const options = (extra = {}) => ({
    sourceRoot,
    dshHome,
    profile: 'manuel',
    coreEntry: checkoutEntry,
    nodeBinary: process.execPath,
    coreEntrySource: '/config/launcher.json',
    env: { PATH: process.env.PATH },
    hostsRunning: () => [],
    ...extra,
  })
  return { root, sourceRoot, checkoutEntry, dshHome, profileDir, options }
}

test('the checkout core with a composing profile passes and writes nothing', t => {
  const w = world(t)
  const result = Preflight.run(w.options())
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.notes, [])
  assert.equal(result.ok, true)
})

test('an older core forced by DSH_CORE_ENTRY under new plugins fails, naming both cores and the fix', t => {
  const w = world(t)
  const oldEntry = fakeCore(join(w.root, 'old-global'), '0.2.1-rc.2')
  const skip =
    'dsh: skipping profile bundle "@dshfiles/chat": Error: Plugin @dshfiles/chat@0.1.0 is incompatible with dsh 0.2.1-rc.2: requirements {"@deepseek-ai/dsh":">=0.2.2-rc.2 <0.3.0-0"}\n'
  const result = Preflight.run(w.options({ coreEntry: oldEntry, coreEntrySource: 'DSH_CORE_ENTRY', env: { PATH: process.env.PATH, FAKE_DUMP_STDERR: skip } }))
  assert.equal(result.ok, false)
  assert.match(result.notes[0], /runs dsh 0\.2\.1-rc\.2 from .*old-global.* \(DSH_CORE_ENTRY\), not the core this checkout installs \(dsh 0\.2\.2-rc\.2 at /)
  const [problem] = result.problems
  assert.equal(problem.check, 'composition')
  assert.match(problem.message, /would skip bundle @dshfiles\/chat, so every service it provides would be missing/)
  assert.match(problem.message, /set coreEntry to .*checkout\/node_modules\/@deepseek-ai\/dsh\/lib\/bin\.js .*or unset DSH_CORE_ENTRY/)
})

test('an explicitly configured other core that composes is kept and only noted', t => {
  const w = world(t)
  const other = fakeCore(join(w.root, 'pinned'), '0.2.2-rc.2')
  const result = Preflight.run(w.options({ coreEntry: other }))
  assert.equal(result.ok, true)
  assert.match(result.notes[0], /runs dsh 0\.2\.2-rc\.2 from .*pinned/)
})

test('a composition the core cannot load fails with its own error', t => {
  const w = world(t)
  const env = { PATH: process.env.PATH, FAKE_DUMP_EXIT: '1', FAKE_DUMP_STDERR: 'YAMLException: end of the stream or a document separator is expected (12:1)\n' }
  const [problem] = Preflight.run(w.options({ env })).problems
  assert.equal(problem.check, 'composition')
  assert.match(problem.message, /could not compose profile manuel \(exit 1\):\nYAMLException/)
})

test('a Node outside the core engines range fails with the version to install', t => {
  const w = world(t)
  const strict = fakeCore(join(w.root, 'strict'), '0.2.2-rc.2', { node: '>=99.0.0' })
  const node = Preflight.run(w.options({ coreEntry: strict })).problems.find(problem => problem.check === 'node')
  assert.match(node.message, /requires Node >=99\.0\.0, but the Host would run on v\d+/)
  assert.match(node.message, /fnm install 24\.11\.1/)
})

test('an entry outside any dsh package fails before anything runs', t => {
  const w = world(t)
  const result = Preflight.run(w.options({ coreEntry: join(w.root, 'missing.js') }))
  assert.equal(result.problems[0].check, 'core')
})

test('a saved 0.2.1 preset is migrated with a backup when no Host runs, and only reported while one does', t => {
  const w = world(t)
  writeFileSync(join(w.profileDir, 'cordis.patch.yml'), FIXTURE)
  const blocked = Preflight.run(w.options({ apply: true, hostsRunning: () => [4242] }))
  assert.equal(blocked.ok, false)
  assert.ok(blocked.problems.every(problem => problem.check === 'presets' && /Stop the DSH Host \(pid 4242\)/.test(problem.message)))
  assert.equal(readFileSync(join(w.profileDir, 'cordis.patch.yml'), 'utf8'), FIXTURE)

  const checkOnly = Preflight.run(w.options())
  assert.equal(checkOnly.ok, false)
  assert.equal(readFileSync(join(w.profileDir, 'cordis.patch.yml'), 'utf8'), FIXTURE)

  const applied = Preflight.run(w.options({ apply: true }))
  assert.deepEqual(applied.problems, [])
  const migrated = readFileSync(join(w.profileDir, 'cordis.patch.yml'), 'utf8')
  assert.ok(!migrated.includes("name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'") && migrated.includes('modelDiscovery: true'))
  const backups = readdirSync(w.profileDir).filter(name => name.includes('before-presets'))
  assert.equal(backups.length, 1)
  assert.equal(readFileSync(join(w.profileDir, backups[0]), 'utf8'), FIXTURE)
  assert.ok(Preflight.run(w.options({ apply: true })).ok, 'a second start has nothing left to migrate')
  assert.equal(readdirSync(w.profileDir).filter(name => name.includes('before-presets')).length, 1)
})

test('a preset naming a module no recorded change explains stops the start', t => {
  const w = world(t)
  writeFileSync(
    join(w.profileDir, 'cordis.patch.yml'),
    `- insert:\n    - id: preset-mine\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: mine\n        plugins:\n          - id: gone\n            name: '@acme/dsh-tool-gone'\n`,
  )
  const result = Preflight.run(w.options({ apply: true }))
  assert.equal(result.ok, false)
  assert.match(result.problems[0].message, /preset "mine" .*@acme\/dsh-tool-gone does not resolve against dsh 0\.2\.2-rc\.2/)
})
