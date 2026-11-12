import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  // The process table the guard reads: `ps axeww -o pid=,uid=,command=` lines (argv, then the environment).
  writeFileSync(join(bin, 'ps'), '#!/bin/sh\nprintf "%s" "$FAKE_PS_OUTPUT"\nexit "${FAKE_PS_STATUS:-0}"\n', { mode: 0o700 })
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

test('no arguments use configured source supervisor under the launch lock, never a live profile', async t => {
  const f = fixture(t)
  assert.equal(await launchDsh([], f.config, f.env), 0)
  const child = JSON.parse(readFileSync(f.output, 'utf8'))
  assert.equal(child.dshHome, f.env.DSH_HOME)
  assert.equal(child.home, f.home)
  assert.equal(child.profile, 'web')
  assert.deepEqual(child.args, [])
  assert.equal(existsSync(join(f.env.DSH_HOME, 'runtime/source-launch.lock')), false)
})

test('a live launch lock holder prevents a second supervisor; a dead holder is taken over', async t => {
  const f = fixture(t)
  const lock = join(f.env.DSH_HOME, 'runtime/source-launch.lock')
  mkdirSync(dirname(lock), { recursive: true })
  writeFileSync(lock, `${process.pid}\n`)
  await assert.rejects(launchDsh([], f.config, f.env), /already launching/)
  assert.throws(() => readFileSync(f.output), /ENOENT/)

  writeFileSync(lock, `${spawnSync(process.execPath, ['-e', '']).pid}\n`)
  assert.equal(await launchDsh([], f.config, f.env), 0)
  assert.deepEqual(JSON.parse(readFileSync(f.output, 'utf8')).args, [])
  assert.equal(existsSync(lock), false)
})

test('existing or unknown process status prevents any supervisor execution', async t => {
  const f = fixture(t)
  const uid = process.getuid()
  const supervised = `4242 ${uid} node ${f.config.coreEntry} --profile web --no-open DSH_HOME=${f.env.DSH_HOME} HOME=${f.home}\n`
  await assert.rejects(launchDsh([], f.config, { ...f.env, FAKE_PS_OUTPUT: supervised }), /already running/)
  await assert.rejects(launchDsh([], f.config, { ...f.env, FAKE_PS_STATUS: '2' }), /Could not check/)
  assert.throws(() => readFileSync(f.output), /ENOENT/)
})

// 2026-11-12: a launcher run found no Host and relinked the profile of a DSH started by hand as
// `DSH_HOME=… node dsh-runtime/node_modules/.bin/dsh web`, because the guard matched only `<coreEntry> --profile web`.
test('a Host on this home started any other way blocks the launch before any build or profile write', async t => {
  const f = fixture(t)
  const uid = process.getuid()
  for (const command of [
    `node dsh-runtime/node_modules/.bin/dsh web DSH_HOME=${f.env.DSH_HOME} HOME=${f.home}`,
    `/usr/local/bin/node /elsewhere/node_modules/@deepseek-ai/dsh/lib/bin.js --profile=web DSH_HOME=${f.env.DSH_HOME} HOME=${f.home}`,
    `dsh --profile web --port 4000 DSH_HOME=${f.env.DSH_HOME} HOME=${f.home}`,
  ]) {
    await assert.rejects(launchDsh([], f.config, { ...f.env, FAKE_PS_OUTPUT: `4242 ${uid} ${command}\n` }), /already running/, command)
  }
  assert.throws(() => readFileSync(f.output), /ENOENT/)
  assert.equal(existsSync(join(f.env.DSH_HOME, 'runtime/source-launch.lock')), false)
})

test('Hosts of another home, another profile or another user do not block the launch', async t => {
  const f = fixture(t)
  const uid = process.getuid()
  const others = [
    `4242 ${uid} node dsh-runtime/node_modules/.bin/dsh web DSH_HOME=${join(f.home, 'other')} HOME=${f.home}`,
    `4243 ${uid} node ${f.config.coreEntry} --profile probe DSH_HOME=${f.env.DSH_HOME} HOME=${f.home}`,
    `4244 ${uid} node dsh-runtime/node_modules/.bin/dsh plugin --profile web add x DSH_HOME=${f.env.DSH_HOME} HOME=${f.home}`,
    `4245 ${uid + 1} node dsh-runtime/node_modules/.bin/dsh web DSH_HOME=${f.env.DSH_HOME} HOME=${f.home}`,
  ].join('\n')
  assert.equal(await launchDsh([], f.config, { ...f.env, FAKE_PS_OUTPUT: `${others}\n` }), 0)
  assert.deepEqual(JSON.parse(readFileSync(f.output, 'utf8')).args, [])
})

test('the launcher says which home, profile and source it prepares before it starts', async t => {
  const f = fixture(t)
  const lines = []
  assert.equal(await launchDsh([], f.config, f.env, line => lines.push(line)), 0)
  assert.equal(lines.length, 1)
  assert.match(lines[0], new RegExp(`home ${f.env.DSH_HOME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.match(lines[0], /profile web/)
  assert.match(lines[0], new RegExp(`source ${f.env.DSHFILES_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
})

test('missing core and optional home marker fail before execution', async t => {
  const f = fixture(t)
  await assert.rejects(launchDsh([], { ...f.config, coreEntry: join(f.home, 'missing') }, f.env), /runtime is missing/)
  await assert.rejects(launchDsh([], { ...f.config, homeVerificationFile: join(f.home, 'marker') }, f.env), /verification is missing/)
  assert.throws(() => readFileSync(f.output), /ENOENT/)
})
