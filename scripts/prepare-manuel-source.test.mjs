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
  writeFileSync(join(bin, 'pgrep'), '#!/bin/sh\nexit 1\n', { mode: 0o700 })
  writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nprintf x >> "$DSH_HOME/installed"\n', { mode: 0o700 })
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, 'config'),
    DSH_HOME: dshHome,
    DSHFILES_DIR: root,
    DSHFILES_PROFILE: 'custom',
    DSH_CORE_ENTRY: join(home, 'fake-core.mjs'),
    PATH: `${bin}:${process.env.PATH}`,
  }
  delete env.DSHFILES_LAUNCHER_CONFIG
  const run = (...args) => spawnSync(process.execPath, [join(import.meta.dirname, 'prepare-manuel-source.mjs'), ...args], { env, encoding: 'utf8' })
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
