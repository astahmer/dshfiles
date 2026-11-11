import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { activeSafeProfile } from './safe-mode.mjs'

const script = join(import.meta.dirname, 'safe-mode.mjs')

const userPatch = `# Port and model defaults live on native rows.
- id: web
  config:
    port: 3080
# Search is owned by a plugin, so the native backend is off.
- id: session-query-sqlite
  disabled: true
- id: dshfiles-owned-row
  config:
    enabled: true
- insert:
    - id: extra-tool
      name: '@third/tool'
- id: ui-chat
  config:
    width: 2
`

const fixture = t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-safe-mode-'))
  t.after(() => {
    assert.equal(dirname(root), tmpdir())
    rmSync(root, { recursive: true, force: true })
  })
  const home = join(root, 'home')
  const source = join(home, 'profiles/web')
  const bin = join(root, 'bin')
  mkdirSync(join(source, 'node_modules/@dshfiles/session-search'), { recursive: true })
  mkdirSync(bin)
  const manifest = JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dependencies: { '@dshfiles/session-search': 'link:../../plugins/session-search', '@third/tool': '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@dshfiles/session-search', '@deepseek-ai/dsh-web-app', '@third/tool'] } },
  })
  writeFileSync(join(source, 'package.json'), manifest)
  writeFileSync(join(source, 'cordis.patch.yml'), userPatch)
  writeFileSync(join(source, 'node_modules/@dshfiles/session-search/package.json'), JSON.stringify({ dsh: { bundle: { patch: './layer.yml' } } }))
  writeFileSync(
    join(source, 'node_modules/@dshfiles/session-search/layer.yml'),
    '- id: session-query-sqlite\n  disabled: true\n- insert:\n    - id: dshfiles-owned-row\n',
  )
  const dsh = join(bin, 'fake-dsh')
  writeFileSync(dsh, `#!/bin/sh\necho "$@" >> "${join(root, 'dsh-calls')}"\nprintf -- '- id: web\\n- id: ui-chat\\n- id: session-query-sqlite\\n'\n`, {
    mode: 0o700,
  })
  writeFileSync(join(bin, 'pgrep'), '#!/bin/sh\nexit "${FAKE_PGREP_STATUS:-1}"\n', { mode: 0o700 })
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, 'config'), DSH_HOME: home, PATH: `${bin}:${process.env.PATH}` }
  delete env.DSHFILES_LAUNCHER_CONFIG
  const run = (args, extra = {}) => spawnSync(process.execPath, [script, ...args, '--dsh', dsh], { env: { ...env, ...extra }, encoding: 'utf8' })
  return { home, source, run, manifest }
}

test('start composes a sibling profile, leaves the source byte-identical, and stop removes it', t => {
  const f = fixture(t)
  const started = f.run(['start', '--profile', 'web', '--json'])
  assert.equal(started.status, 0, started.stderr)
  const marker = JSON.parse(started.stdout)
  assert.equal(marker.status, 'active')
  assert.deepEqual(marker.disabledBundles, ['@dshfiles/session-search', '@third/tool'])
  assert.deepEqual(marker.droppedPatchEntries, ['session-query-sqlite', 'dshfiles-owned-row', 'insert @third/tool'])
  const safe = join(f.home, 'profiles/web-safe')
  assert.deepEqual(JSON.parse(readFileSync(join(safe, 'package.json'), 'utf8')).dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  const patch = readFileSync(join(safe, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /- id: web\n {2}config:\n {4}port: 3080/)
  assert.match(patch, /- id: ui-chat/)
  assert.doesNotMatch(patch, /session-query-sqlite|dshfiles-owned-row|@third\/tool/)
  assert.equal(activeSafeProfile({ home: f.home, profile: 'web' }), 'web-safe')
  assert.equal(readFileSync(join(f.source, 'package.json'), 'utf8'), f.manifest)
  assert.equal(readFileSync(join(f.source, 'cordis.patch.yml'), 'utf8'), userPatch)

  assert.equal(f.run(['start', '--profile', 'web']).status, 0, 'a second start recomposes')
  const stopped = f.run(['stop', '--profile', 'web', '--json'])
  assert.equal(stopped.status, 0, stopped.stderr)
  assert.equal(JSON.parse(stopped.stdout).profileUnchanged, true)
  assert.equal(existsSync(safe), false)
  assert.deepEqual(readdirSync(join(f.home, 'profiles')), ['web'])
  assert.equal(activeSafeProfile({ home: f.home, profile: 'web' }), undefined)
  const again = f.run(['stop', '--profile', 'web'])
  assert.equal(again.status, 0)
  assert.match(again.stdout, /was not on/)
})

test('a crashed start is never booted and stop clears it', t => {
  const f = fixture(t)
  const safe = join(f.home, 'profiles/web-safe')
  mkdirSync(safe)
  writeFileSync(join(safe, '.dshfiles-safe-mode.json'), JSON.stringify({ status: 'composing', disabledBundles: [] }))
  mkdirSync(join(f.home, 'profiles/.web-safe.staging-999'))
  assert.equal(activeSafeProfile({ home: f.home, profile: 'web' }), undefined)
  assert.equal(f.run(['stop', '--profile', 'web']).status, 0)
  assert.deepEqual(readdirSync(join(f.home, 'profiles')), ['web'])
})

test('refuses a foreign profile, a running safe-mode Host and unknown --keep bundles', t => {
  const f = fixture(t)
  mkdirSync(join(f.home, 'profiles/web-safe'))
  assert.match(f.run(['start', '--profile', 'web']).stderr, /not a safe-mode profile/)
  assert.match(f.run(['stop', '--profile', 'web']).stderr, /not a safe-mode profile/)
  rmSync(join(f.home, 'profiles/web-safe'), { recursive: true })
  assert.match(f.run(['start', '--profile', 'web', '--keep', '@dshfiles/absent']).stderr, /does not load: @dshfiles\/absent/)
  assert.equal(f.run(['start', '--profile', 'web']).status, 0)
  const refused = f.run(['stop', '--profile', 'web'], { FAKE_PGREP_STATUS: '0' })
  assert.match(refused.stderr, /DSH is running web-safe/)
  assert.equal(activeSafeProfile({ home: f.home, profile: 'web' }), 'web-safe')
  assert.match(f.run(['start', '--profile', 'web-safe']).stderr, /not web-safe/)
})
