import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { LauncherInstall } from './install-launcher.mjs'

const ROOT = resolve(import.meta.dirname, '..')

const fixture = t => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-install-launcher-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const env = { HOME: home, XDG_CONFIG_HOME: join(home, 'config'), PATH: '/usr/bin:/bin' }
  const configPath = join(home, 'config/dshfiles/launcher.json')
  mkdirSync(dirname(configPath), { recursive: true })
  const bin = join(home, 'bin/dsh')
  return { home, env, configPath, bin }
}

test('a dry run writes nothing; apply replaces a hand-written wrapper and drops only derived pins, with backups', t => {
  const f = fixture(t)
  const fnmNode = '/home/me/.local/share/fnm/node-versions/v22.23.3/installation/bin/node'
  const local = {
    sourceRoot: ROOT,
    profile: 'manuel',
    legacyPort: 3198,
    nodeBinary: fnmNode,
    coreEntry: join(ROOT, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    path: `${dirname(fnmNode)}:/usr/bin`,
    nodePath: join(ROOT, 'node_modules'),
  }
  writeFileSync(f.configPath, JSON.stringify(local))
  mkdirSync(dirname(f.bin), { recursive: true })
  const wrapper = '#!/usr/bin/env bash\nnode_dir=/pinned/v22\nexec "$node_dir/node" core.js "$@"\n'
  writeFileSync(f.bin, wrapper)

  const dry = LauncherInstall.install({ bin: f.bin, env: f.env })
  assert.match(dry.join('\n'), /Would install .* \(the current file is backed up\)/)
  assert.match(dry.join('\n'), /Would remove .*nodeBinary .*v22\.23\.3/)
  assert.equal(readFileSync(f.bin, 'utf8'), wrapper)
  assert.deepEqual(JSON.parse(readFileSync(f.configPath, 'utf8')), local)

  LauncherInstall.install({ bin: f.bin, env: f.env, apply: true })
  assert.equal(readFileSync(f.bin, 'utf8'), LauncherInstall.shim(ROOT))
  assert.equal(statSync(f.bin).mode & 0o777, 0o755)
  assert.deepEqual(JSON.parse(readFileSync(f.configPath, 'utf8')), { sourceRoot: ROOT, profile: 'manuel', legacyPort: 3198, nodePath: local.nodePath })
  const binBackups = readdirSync(dirname(f.bin)).filter(name => name.startsWith('dsh.before-install-'))
  assert.equal(readFileSync(join(dirname(f.bin), binBackups[0]), 'utf8'), wrapper)
  const configBackups = readdirSync(dirname(f.configPath)).filter(name => name.includes('before-install'))
  assert.deepEqual(JSON.parse(readFileSync(join(dirname(f.configPath), configBackups[0]), 'utf8')), local)

  const again = LauncherInstall.install({ bin: f.bin, env: f.env, apply: true })
  assert.match(again[0], /already runs/)
  assert.equal(readdirSync(dirname(f.bin)).length, 2, 'a second install writes no new backup')
})

test('an explicit core outside the checkout and a non-fnm Node stay', () => {
  const local = { nodeBinary: '/opt/node/bin/node', coreEntry: '/opt/dsh/lib/bin.js', path: '/opt/node/bin:/usr/bin' }
  assert.deepEqual(LauncherInstall.migratedConfig(local, ROOT), { config: local, removed: [] })
})

test('refuses to point dsh at a checkout other than the configured source', t => {
  const f = fixture(t)
  writeFileSync(f.configPath, JSON.stringify({ sourceRoot: join(f.home, 'elsewhere') }))
  assert.throws(() => LauncherInstall.install({ bin: f.bin, env: f.env, apply: true }), /selects source .*elsewhere/)
})

test('the installed shim runs the checkout launcher', t => {
  const f = fixture(t)
  writeFileSync(f.configPath, JSON.stringify({ sourceRoot: ROOT, coreEntry: join(f.home, 'missing-core.js') }))
  LauncherInstall.install({ bin: f.bin, env: f.env, apply: true })
  const run = spawnSync(f.bin, ['--version'], { env: { ...f.env, PATH: process.env.PATH }, encoding: 'utf8' })
  // The checkout launcher ran: it refuses a missing configured core rather than a missing script.
  assert.match(run.stderr, /Configured runtime is missing; nothing started/)
})
