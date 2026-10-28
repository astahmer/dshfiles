import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { launchDsh } from './launch-dsh.mjs'
import { LauncherConfig } from './launcher-config.mjs'

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-launch-fake-'))
  t.after(() => {
    assert.equal(dirname(home), tmpdir())
    rmSync(home, { recursive: true, force: true })
  })
  const sourceRoot = join(home, 'source')
  const bin = join(home, 'bin')
  mkdirSync(join(sourceRoot, 'scripts'), { recursive: true })
  mkdirSync(bin)
  const output = join(home, 'child.json')
  const fake = `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(output)}, JSON.stringify({args:process.argv.slice(2), home:process.env.HOME, dshHome:process.env.DSH_HOME, profile:process.env.DSHFILES_PROFILE, session:process.env.DSH_SESSION_ID}));`
  const coreEntry = join(home, 'fake-core.mjs')
  writeFileSync(coreEntry, fake)
  writeFileSync(join(sourceRoot, 'scripts/supervise-dsh.mjs'), fake)
  writeFileSync(join(sourceRoot, 'scripts/prepare-manuel-source.mjs'), '// fixture only\n')
  writeFileSync(join(bin, 'pgrep'), '#!/bin/sh\nexit "${FAKE_PGREP_STATUS:-1}"\n', { mode: 0o700 })
  const env = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, 'config'),
    DSHFILES_DIR: sourceRoot,
    DSH_HOME: join(home, 'scratch'),
    DSH_CORE_ENTRY: coreEntry,
    PATH: `${bin}:${process.env.PATH}`,
    DSH_SESSION_ID: 'private-parent',
  }
  return { home, env, output, config: LauncherConfig.load(env) }
}

test('explicit core arguments go only to fake core with inherited HOME and isolated DSH_HOME', async t => {
  const f = fixture(t)
  assert.equal(await launchDsh(['--version'], f.config, f.env), 0)
  assert.deepEqual(JSON.parse(readFileSync(f.output, 'utf8')), { args: ['--version'], home: f.home, dshHome: f.env.DSH_HOME, profile: 'web' })
})

test('no arguments use configured source supervisor under flock, never a live profile', async t => {
  const f = fixture(t)
  assert.equal(await launchDsh([], f.config, f.env), 0)
  const child = JSON.parse(readFileSync(f.output, 'utf8'))
  assert.equal(child.dshHome, f.env.DSH_HOME)
  assert.equal(child.home, f.home)
  assert.equal(child.profile, 'web')
  assert.deepEqual(child.args, [])
})

test('existing or unknown process status prevents any supervisor execution', async t => {
  const f = fixture(t)
  await assert.rejects(launchDsh([], f.config, { ...f.env, FAKE_PGREP_STATUS: '0' }), /already running/)
  await assert.rejects(launchDsh([], f.config, { ...f.env, FAKE_PGREP_STATUS: '2' }), /Could not check/)
  assert.throws(() => readFileSync(f.output), /ENOENT/)
})

test('missing core and optional home marker fail before execution', async t => {
  const f = fixture(t)
  await assert.rejects(launchDsh([], { ...f.config, coreEntry: join(f.home, 'missing') }, f.env), /runtime is missing/)
  await assert.rejects(launchDsh([], { ...f.config, homeVerificationFile: join(f.home, 'marker') }, f.env), /verification is missing/)
  assert.throws(() => readFileSync(f.output), /ENOENT/)
})
