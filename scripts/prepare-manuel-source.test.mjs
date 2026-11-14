import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { sourceLinkedManifest } from './prepare-manuel-source.mjs'

test('relink only selected bundles, preserving selection, configuration and input', () => {
  const original = {
    private: true,
    dependencies: { '@dshfiles/home': 'link:/old/home', '@dshfiles/traces': 'link:/old/traces', community: '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@dshfiles/home'] } },
    custom: { keep: true },
  }
  const before = structuredClone(original)
  const next = sourceLinkedManifest(original, '/canonical')
  assert.equal(next.dependencies['@dshfiles/home'], 'link:/canonical/plugins/@dshfiles/home')
  assert.equal(next.dependencies['@dshfiles/traces'], 'link:/old/traces')
  assert.equal(next.dependencies.community, '1.0.0')
  assert.deepEqual(next.dsh, before.dsh)
  assert.deepEqual(next.custom, before.custom)
  assert.deepEqual(original, before)
})

test('approved HMR gate selection preserves old order and adds no other plugins', () => {
  const original = {
    dependencies: { '@dshfiles/home': 'link:/old' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dshfiles/home'] } },
  }
  const next = sourceLinkedManifest(original, '/canonical', { enableHmrGate: true })
  assert.deepEqual(next.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dshfiles/hmr-gate', '@dshfiles/home'])
  assert.equal(next.dependencies['@dshfiles/hmr-gate'], 'link:/canonical/plugins/@dshfiles/hmr-gate')
  assert.deepEqual(sourceLinkedManifest(next, '/canonical', { enableHmrGate: true }), next)
  assert.equal(original.dsh.profile.bundles.includes('@dshfiles/hmr-gate'), false)
})

test('real profile relink preserves user edits/accounts and never adds unselected plugins', t => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-prepare-local-'))
  t.after(() => {
    assert.equal(dirname(home), tmpdir())
    rmSync(home, { recursive: true, force: true })
  })
  const dshHome = join(home, 'dsh')
  const root = join(home, 'source')
  const profile = join(dshHome, 'profiles/custom')
  const bin = join(home, 'bin')
  mkdirSync(profile, { recursive: true })
  mkdirSync(bin)
  mkdirSync(join(root, 'plugins/@dshfiles/home/dist'), { recursive: true })
  writeFileSync(join(root, 'plugins/@dshfiles/home/package.json'), '{"name":"@dshfiles/home"}')
  writeFileSync(join(root, 'plugins/@dshfiles/home/dist/index.js'), '// fixture')
  const original = {
    dependencies: { '@dshfiles/home': 'link:/old', community: '1.0.0' },
    dsh: { profile: { bundles: ['@dshfiles/home'] } },
    user: { edit: 'preserved' },
  }
  writeFileSync(join(profile, 'package.json'), JSON.stringify(original))
  const patch = '# User edited configuration\n- id: user-row\n  config:\n    keep: true\n'
  writeFileSync(join(profile, 'cordis.patch.yml'), patch)
  mkdirSync(join(dshHome, 'plugins/ai-accounts'), { recursive: true })
  const accounts = '{"accounts":[{"instanceId":"fixture-user-choice"}]}\n'
  writeFileSync(join(dshHome, 'plugins/ai-accounts/accounts.json'), accounts)
  writeFileSync(join(bin, 'ps'), '#!/bin/sh\nprintf "%s" "$FAKE_PS_OUTPUT"\n', { mode: 0o700 })
  writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nprintf x >> "$DSH_HOME/installed"\n', { mode: 0o700 })
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, 'config'),
    DSH_HOME: dshHome,
    DSHFILES_DIR: root,
    DSHFILES_PROFILE: 'custom',
    DSH_CORE_ENTRY: join(home, 'fake-core.mjs'),
    // A Node with no corepack beside it, so the fake pnpm on PATH runs.
    DSHFILES_NODE_BINARY: join(bin, 'node'),
    PATH: `${bin}:${process.env.PATH}`,
  }
  delete env.DSHFILES_LAUNCHER_CONFIG
  const run = (...args) => spawnSync(process.execPath, [join(import.meta.dirname, 'prepare-manuel-source.mjs'), ...args], { env, encoding: 'utf8' })
  // A Host started by hand on this home (2026-11-12: `node dsh-runtime/node_modules/.bin/dsh web`) blocks every write.
  const manual = `4242 ${process.getuid()} node dsh-runtime/node_modules/.bin/dsh custom DSH_HOME=${dshHome} HOME=${home}\n`
  const refused = spawnSync(process.execPath, [join(import.meta.dirname, 'prepare-manuel-source.mjs')], {
    env: { ...env, FAKE_PS_OUTPUT: manual },
    encoding: 'utf8',
  })
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /Stop the existing DSH/)
  assert.deepEqual(JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')), original)
  assert.throws(() => readdirSync(join(dshHome, 'backups')), /ENOENT/)
  const check = run('--check')
  assert.equal(check.status, 0, check.stderr)
  assert.deepEqual(JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')), original)
  const first = run()
  assert.equal(first.status, 0, first.stderr)
  const next = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  assert.deepEqual(next.user, original.user)
  assert.deepEqual(next.dsh, original.dsh)
  assert.equal(next.dependencies.community, '1.0.0')
  assert.equal(next.dependencies['@dshfiles/home'], `link:${root}/plugins/@dshfiles/home`)
  assert.equal(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8'), patch)
  assert.equal(readFileSync(join(dshHome, 'plugins/ai-accounts/accounts.json'), 'utf8'), accounts)
  assert.equal(readFileSync(join(dshHome, 'installed'), 'utf8'), 'x')
  const second = run()
  assert.equal(second.status, 0, second.stderr)
  assert.equal(readFileSync(join(dshHome, 'installed'), 'utf8'), 'x')
  assert.equal(readdirSync(join(dshHome, 'backups/source-link')).length, 1)
})

test('source-link transformation is idempotent and validates selected packages', () => {
  const original = { dependencies: { '@dshfiles/home': 'link:/old' }, dsh: { profile: { bundles: ['@dshfiles/home'] } } }
  const linked = sourceLinkedManifest(original, '/canonical')
  assert.deepEqual(sourceLinkedManifest(linked, '/canonical'), linked)
  assert.throws(() => sourceLinkedManifest({ dependencies: {}, dsh: { profile: { bundles: ['@dshfiles/../escape'] } } }, '/canonical'), /invalid/)
  assert.throws(() => sourceLinkedManifest({ dependencies: {}, dsh: { profile: { bundles: ['@dshfiles/missing'] } } }, '/canonical'), /lacks/)
})

/** A profile in a scratch home whose checkout keeps only build leftovers for the removed and renamed plugins. */
const leftoverFixture = (t, { bundles, dependencies }) => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-prepare-leftover-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const dshHome = join(home, 'dsh')
  const root = join(home, 'source')
  const profile = join(dshHome, 'profiles/custom')
  const bin = join(home, 'bin')
  mkdirSync(profile, { recursive: true })
  mkdirSync(bin)
  const plugin = (name, { source }) => {
    mkdirSync(join(root, 'plugins', name, 'dist'), { recursive: true })
    writeFileSync(join(root, 'plugins', name, 'dist/index.js'), '// stale build')
    if (source) writeFileSync(join(root, 'plugins', name, 'package.json'), JSON.stringify({ name }))
  }
  plugin('@dshfiles/chat', { source: true })
  plugin('@dshfiles/diffs-review', { source: true })
  for (const name of ['@dshfiles/pulls-review', '@dshfiles/plugin-marketplace', '@dshfiles/sidebar-commands', '@dshfiles/vanished'])
    plugin(name, { source: false })
  const original = { dependencies, dsh: { profile: { bundles } }, user: { keep: true } }
  writeFileSync(join(profile, 'package.json'), JSON.stringify(original))
  writeFileSync(join(bin, 'ps'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, 'config'),
    DSH_HOME: dshHome,
    DSHFILES_DIR: root,
    DSHFILES_PROFILE: 'custom',
    DSH_CORE_ENTRY: join(home, 'core.mjs'),
    DSHFILES_NODE_BINARY: join(bin, 'node'),
    PATH: `${bin}:${process.env.PATH}`,
  }
  delete env.DSHFILES_LAUNCHER_CONFIG
  const run = (...args) => spawnSync(process.execPath, [join(import.meta.dirname, 'prepare-manuel-source.mjs'), ...args], { env, encoding: 'utf8' })
  return { root, dshHome, profile, original, run, read: () => JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) }
}

test('a renamed plugin moves in place and removed plugins with stale builds leave the profile, with a backup', t => {
  const link = name => `link:/old/plugins/${name}`
  const bundles = ['@deepseek-ai/dsh-base', '@dshfiles/plugin-marketplace', '@dshfiles/pulls-review', '@dshfiles/chat', '@dshfiles/sidebar-commands']
  const f = leftoverFixture(t, {
    bundles,
    dependencies: Object.fromEntries([...bundles.slice(1), 'community'].map(name => [name, name === 'community' ? '1.0.0' : link(name)])),
  })
  const check = f.run('--check')
  assert.equal(check.status, 0, check.stderr)
  assert.match(check.stdout, /Would migrate the profile: @dshfiles\/pulls-review was renamed @dshfiles\/diffs-review/)
  assert.deepEqual(f.read(), f.original, '--check writes nothing')

  const first = f.run()
  assert.equal(first.status, 0, first.stderr)
  const next = f.read()
  assert.deepEqual(next.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@dshfiles/diffs-review', '@dshfiles/chat'])
  assert.deepEqual(Object.keys(next.dependencies).sort(), ['@dshfiles/chat', '@dshfiles/diffs-review', 'community'])
  assert.equal(next.dependencies['@dshfiles/diffs-review'], `link:${f.root}/plugins/@dshfiles/diffs-review`)
  assert.deepEqual(next.user, f.original.user)
  for (const name of ['plugin-marketplace', 'sidebar-commands']) assert.match(first.stdout, new RegExp(`@dshfiles/${name} was removed`))
  const [backup] = readdirSync(join(f.dshHome, 'backups/source-link'))
  assert.deepEqual(JSON.parse(readFileSync(join(f.dshHome, 'backups/source-link', backup, 'package.json'), 'utf8')), f.original)

  const second = f.run()
  assert.equal(second.status, 0, second.stderr)
  assert.deepEqual(f.read(), next, 'the migration is idempotent')
  assert.equal(readdirSync(join(f.dshHome, 'backups/source-link')).length, 1)
})

test('a selected plugin whose sources vanished for no recorded reason stops startup and changes nothing', t => {
  const bundles = ['@dshfiles/chat', '@dshfiles/vanished']
  const f = leftoverFixture(t, { bundles, dependencies: { '@dshfiles/chat': 'link:/old/chat', '@dshfiles/vanished': 'link:/old/vanished' } })
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /@dshfiles\/vanished is selected in .*package\.json, but .*has no package\.json/)
  assert.match(result.stderr, /remove @dshfiles\/vanished from dsh\.profile\.bundles/)
  assert.deepEqual(f.read(), f.original)
  assert.throws(() => readdirSync(join(f.dshHome, 'backups')), /ENOENT/)
})

test('a rename never duplicates a target the profile already selects', t => {
  const bundles = ['@dshfiles/diffs-review', '@dshfiles/pulls-review']
  const f = leftoverFixture(t, { bundles, dependencies: { '@dshfiles/diffs-review': 'link:/a', '@dshfiles/pulls-review': 'link:/b' } })
  assert.equal(f.run().status, 0)
  assert.deepEqual(f.read().dsh.profile.bundles, ['@dshfiles/diffs-review'])
})
