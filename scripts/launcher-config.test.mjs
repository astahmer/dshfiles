import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { LauncherConfig } from './launcher-config.mjs'

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-launcher-config-'))
  t.after(() => {
    assert.equal(dirname(home), tmpdir())
    rmSync(home, { recursive: true, force: true })
  })
  const env = { HOME: home, XDG_CONFIG_HOME: join(home, 'config'), DSH_HOME: join(home, 'isolated-dsh') }
  const file = join(env.XDG_CONFIG_HOME, 'dshfiles/launcher.json')
  mkdirSync(dirname(file), { recursive: true })
  return { home, env, file }
}

test('missing optional local config has no personal account/runtime selection and preserves scratch home', t => {
  const f = fixture(t)
  const config = LauncherConfig.load(f.env)
  assert.equal(config.profile, 'web')
  assert.equal(config.dshHome, f.env.DSH_HOME)
  assert.equal(config.nodeBinary, process.execPath)
  assert.equal(config.coreEntry, undefined)
  assert.equal(config.legacyPort, undefined)
  // Without a configured core, the checkout's own lockfile core runs; with neither, nothing starts.
  const withCore = join(f.home, 'with-core')
  mkdirSync(join(withCore, 'node_modules/@deepseek-ai/dsh/lib'), { recursive: true })
  writeFileSync(join(withCore, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '')
  assert.equal(LauncherConfig.requireCoreEntry({ ...config, sourceRoot: withCore }), join(withCore, 'node_modules/@deepseek-ai/dsh/lib/bin.js'))
  assert.throws(() => LauncherConfig.requireCoreEntry({ ...config, sourceRoot: join(f.home, 'no-core') }), /No DSH core: configure coreEntry/)
  assert.throws(() => LauncherConfig.load({ ...f.env, DSHFILES_LAUNCHER_CONFIG: join(f.home, 'absent') }), /ENOENT/)
})

test('present config and explicit environment precedence never rewrite the local config', t => {
  const f = fixture(t)
  const local = {
    profile: 'custom',
    coreEntry: join(f.home, 'core[1].mjs'),
    dshHome: join(f.home, 'local'),
    legacyPort: 1234,
    path: '/bin',
    nodePath: '/opt/modules',
  }
  const original = JSON.stringify(local)
  writeFileSync(f.file, original)
  const config = LauncherConfig.load({ ...f.env, DSHFILES_PROFILE: 'chosen', DSHFILES_LEGACY_PORT: '4321' })
  assert.equal(config.profile, 'chosen')
  assert.equal(config.dshHome, f.env.DSH_HOME)
  assert.equal(config.legacyPort, 4321)
  const env = LauncherConfig.environment(config, { ...f.env, DSH_SESSION_ID: 'parent-session', DSH_RESTART_RUN_ID: 'old' })
  assert.equal(env.HOME, f.home)
  assert.equal(env.XDG_CONFIG_HOME, f.env.XDG_CONFIG_HOME)
  assert.equal(env.PATH, '/bin')
  assert.equal(env.NODE_PATH, '/opt/modules')
  assert.equal(env.DSH_SESSION_ID, undefined)
  assert.equal(env.DSH_RESTART_RUN_ID, undefined)
  assert.equal(env.DSHFILES_PROFILE, 'chosen')
  assert.equal(env.NODE_COMPILE_CACHE, join(f.env.XDG_CACHE_HOME ?? join(f.home, '.cache'), 'dshfiles', 'node-compile-cache'))
  assert.equal(LauncherConfig.environment(config, { ...f.env, NODE_COMPILE_CACHE: '/chosen/cache' }).NODE_COMPILE_CACHE, '/chosen/cache')
  assert.equal(readFileSync(f.file, 'utf8'), original)
})

// 2026-11-12: run from an agent shell, the launcher took the Host's inherited DSH_HOME over launcher.json's scratch
// dshHome and prepared the live home instead.
test('a DSH_HOME inherited from a DSH shell never silently replaces the configured dshHome', t => {
  const f = fixture(t)
  const configured = join(f.home, 'configured')
  writeFileSync(f.file, JSON.stringify({ dshHome: configured }))
  for (const shell of [{ DSH_SESSION_ID: 'session-parent' }, { DSH_SHELL: '1' }]) {
    assert.throws(() => LauncherConfig.load({ ...f.env, ...shell }), /inherited from a running DSH/)
  }
  // The same home from a DSH shell, or any explicit override from a plain terminal, keeps the documented precedence.
  assert.equal(LauncherConfig.load({ ...f.env, DSH_HOME: `${configured}/`, DSH_SESSION_ID: 'session-parent' }).dshHome, `${configured}/`)
  assert.equal(LauncherConfig.load(f.env).dshHome, f.env.DSH_HOME)
})

test('malformed configuration fails closed, including unknown keys and path/profile escapes', t => {
  const f = fixture(t)
  for (const text of [
    '{',
    'null',
    '[]',
    '{"profile":"../escape"}',
    '{"coreEntry":"relative"}',
    '{"legacyPort":70000}',
    '{"legacyPort":"1234"}',
    '{"nodeBinary":"/bin/node\\ncommand"}',
    '{"extra":"ignored?"}',
  ]) {
    writeFileSync(f.file, text)
    assert.throws(() => LauncherConfig.load(f.env))
    assert.equal(readFileSync(f.file, 'utf8'), text)
  }
  writeFileSync(f.file, '{}')
  assert.throws(() => LauncherConfig.load({ ...f.env, DSHFILES_PROFILE: '' }), /nonempty/)
  assert.throws(() => LauncherConfig.load({ ...f.env, DSHFILES_LEGACY_PORT: 'bad' }), /legacyPort/)
  assert.throws(() => LauncherConfig.load({ ...f.env, DSHFILES_LEGACY_PORT: '' }), /legacyPort/)
})
