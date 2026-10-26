import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'

const script = join(import.meta.dirname, 'profile-sync.ts')
const webSeed = JSON.parse(readFileSync(join(import.meta.dirname, '../profiles/web/package.json'), 'utf8'))
const patchRegion = '# BEGIN NIX-MANAGED DSH PLUGINS\n- id: managed\n# END NIX-MANAGED DSH PLUGINS\n'

let root
let home
let seedDirectory
const profileDirectory = () => join(home, 'profiles/web')
const write = (path, content) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
const writeJson = (path, value) => write(path, `${JSON.stringify(value, null, 2)}\n`)
const readProfile = () => JSON.parse(readFileSync(join(profileDirectory(), 'package.json'), 'utf8'))
const plugin = name => {
  const directory = join(root, 'checkout/plugins/@dshfiles', name)
  writeJson(join(directory, 'package.json'), { name: `@dshfiles/${name}`, version: '0.0.0' })
  write(join(directory, 'cordis.patch.yml'), '[]\n')
}
const writeSeed = bundles =>
  writeJson(join(seedDirectory, 'package.json'), {
    name: 'dsh-profile-web',
    private: true,
    dependencies: Object.fromEntries(bundles.map(name => [`@dshfiles/${name}`, `link:../../plugins/@dshfiles/${name}`])),
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', ...bundles.map(name => `@dshfiles/${name}`)] } },
  })
const syncWithEnv = (env, ...args) => {
  const result = spawnSync(process.execPath, [script, '--profile', 'web', '--home', home, '--seed', seedDirectory, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}
const sync = (...args) => syncWithEnv({}, ...args)

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'profile-sync-test-')))
  home = join(root, 'dsh-home')
  seedDirectory = join(root, 'checkout/profiles/web')
  for (const name of ['alpha', 'beta', 'gamma']) plugin(name)
  writeJson(join(root, 'user-plugin/package.json'), { name: 'user-plugin', version: '0.0.0' })
  writeSeed(['alpha', 'beta'])
  write(join(seedDirectory, 'cordis.patch.yml'), `- id: seeded\n${patchRegion}`)
  write(join(seedDirectory, 'ai-accounts.json'), '{"accounts":[]}\n')
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

test('seeds a missing profile, resolves relative links and installs once', () => {
  const first = sync()
  assert.equal(first.status, 0, first.output)
  const profile = readProfile()
  assert.equal(profile.dependencies['@dshfiles/alpha'], `link:${join(root, 'checkout/plugins/@dshfiles/alpha')}`)
  assert.deepEqual(profile.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@dshfiles/alpha', '@dshfiles/beta'])
  assert.equal(statSync(join(profileDirectory(), 'package.json')).mode & 0o777, 0o600)
  assert.ok(existsSync(join(home, 'plugins/ai-accounts/accounts.json')))
  assert.ok(existsSync(join(profileDirectory(), 'node_modules/@dshfiles/alpha/package.json')))
  assert.match(first.output, /pnpm install/)

  const second = sync()
  assert.equal(second.status, 0, second.output)
  assert.match(second.output, /is up to date/)
  assert.doesNotMatch(second.output, /pnpm install/)
})

test('adds and removes seed bundles and keeps what the user added', () => {
  assert.equal(sync().status, 0)
  const profile = readProfile()
  profile.dependencies['user-plugin'] = `link:${join(root, 'user-plugin')}`
  profile.dsh.profile.bundles.push('user-plugin')
  writeJson(join(profileDirectory(), 'package.json'), profile)
  write(join(profileDirectory(), 'cordis.patch.yml'), `- id: user-entry\n${patchRegion.replace('managed', 'edited')}`)
  writeSeed(['alpha', 'gamma'])

  const result = sync()
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /^ {2}\+ @dshfiles\/gamma$/m)
  assert.match(result.output, /^ {2}- @dshfiles\/beta$/m)
  const next = readProfile()
  assert.deepEqual(next.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@dshfiles/alpha', 'user-plugin', '@dshfiles/gamma'])
  assert.equal(next.dependencies['@dshfiles/beta'], undefined)
  assert.equal(next.dependencies['user-plugin'], `link:${join(root, 'user-plugin')}`)
  assert.ok(existsSync(join(profileDirectory(), 'node_modules/@dshfiles/gamma/package.json')))
  assert.equal(readFileSync(join(profileDirectory(), 'cordis.patch.yml'), 'utf8'), `- id: user-entry\n${patchRegion}`)
})

test('explicitly updates the profile lockfile after seed changes under CI', () => {
  const first = syncWithEnv({ CI: 'true' })
  assert.equal(first.status, 0, first.output)
  const lockfile = join(profileDirectory(), 'pnpm-lock.yaml')
  const previousLockfile = readFileSync(lockfile, 'utf8')
  writeSeed(['alpha', 'gamma'])

  const pnpm = process.env.PATH.split(delimiter)
    .map(directory => join(directory, 'pnpm'))
    .find(path => existsSync(path))
  assert.ok(pnpm)
  const bin = join(root, 'bin')
  const invocation = join(root, 'pnpm-invocation.json')
  const wrapper = join(bin, 'pnpm')
  write(
    wrapper,
    `#!${process.execPath}
const { spawnSync } = require('node:child_process')
const { readFileSync, writeFileSync } = require('node:fs')
writeFileSync(${JSON.stringify(invocation)}, JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  ci: process.env.CI,
  lock: readFileSync('package.json.lock', 'utf8'),
}))
const result = spawnSync(${JSON.stringify(pnpm)}, process.argv.slice(2), { stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
`,
  )
  chmodSync(wrapper, 0o700)

  const result = syncWithEnv({ CI: 'true', PATH: `${bin}${delimiter}${process.env.PATH}` })
  assert.equal(result.status, 0, result.output)
  const recorded = JSON.parse(readFileSync(invocation, 'utf8'))
  assert.deepEqual(recorded.args, ['install', '--prefer-offline', '--no-frozen-lockfile'])
  assert.equal(recorded.cwd, profileDirectory())
  assert.equal(recorded.ci, 'true')
  assert.match(recorded.lock, /^\d+\n$/)
  assert.notEqual(readFileSync(lockfile, 'utf8'), previousLockfile)
  assert.ok(existsSync(join(profileDirectory(), 'node_modules/@dshfiles/gamma/package.json')))
  assert.ok(!existsSync(join(profileDirectory(), 'package.json.lock')))
  const unchanged = syncWithEnv({ CI: 'true' })
  assert.equal(unchanged.status, 0, unchanged.output)
  assert.match(unchanged.output, /is up to date/)
})

test('drops a managed entry the seed no longer has, unless the user changed it', () => {
  writeJson(join(root, 'checkout/plugins/market/package.json'), { name: 'market', version: '0.0.0' })
  writeJson(join(root, 'checkout/plugins/other/package.json'), { name: 'other', version: '0.0.0' })
  const seed = JSON.parse(readFileSync(join(seedDirectory, 'package.json'), 'utf8'))
  seed.dependencies.market = 'link:../../plugins/market'
  seed.dependencies.other = 'link:../../plugins/other'
  seed.dsh.profile.bundles.push('market', 'other')
  writeJson(join(seedDirectory, 'package.json'), seed)
  assert.equal(sync().status, 0)
  const profile = readProfile()
  profile.dependencies.other = `link:${join(root, 'user-plugin')}`
  writeJson(join(profileDirectory(), 'package.json'), profile)
  writeSeed(['alpha', 'beta'])

  assert.equal(sync().status, 0)
  const next = readProfile()
  assert.equal(next.dependencies.market, undefined)
  assert.equal(next.dependencies.other, `link:${join(root, 'user-plugin')}`)
  assert.ok(!next.dsh.profile.bundles.includes('market'))
})

test('fails without touching the profile when a seed bundle is missing', () => {
  assert.equal(sync().status, 0)
  const before = readFileSync(join(profileDirectory(), 'package.json'), 'utf8')
  writeSeed(['alpha', 'missing'])
  const result = sync()
  assert.equal(result.status, 1)
  assert.match(result.output, /@dshfiles\/missing links to .*not an owned bundle/)
  assert.equal(readFileSync(join(profileDirectory(), 'package.json'), 'utf8'), before)
})

test('waits for the DSH profile lock and takes it over from an exited holder', () => {
  assert.equal(sync().status, 0)
  const exited = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout
  write(join(profileDirectory(), 'package.json.lock'), `${exited}\n`)
  writeSeed(['alpha'])
  const result = sync()
  assert.equal(result.status, 0, result.output)
  assert.ok(!existsSync(join(profileDirectory(), 'package.json.lock')))
  assert.ok(!readProfile().dsh.profile.bundles.includes('@dshfiles/beta'))
})

test('the checked-in web seed links only owned bundles from this checkout', () => {
  const dryRunHome = join(root, 'web-home')
  writeJson(join(dryRunHome, 'profiles/web/package.json'), {
    dependencies: { '@dshfiles/stale-fixture': 'link:/elsewhere/stale-fixture' },
    dsh: { profile: { bundles: ['@dshfiles/stale-fixture'] } },
  })
  const output = execFileSync(process.execPath, [script, '--profile', 'web', '--home', dryRunHome, '--dry-run'], { encoding: 'utf8' })
  assert.match(output, /^ {2}- @dshfiles\/stale-fixture$/m)
  const added = output
    .split('\n')
    .filter(line => line.startsWith('  + '))
    .map(line => line.slice(4))
  assert.deepEqual(added, webSeed.dsh.profile.bundles)
  assert.equal(readFileSync(join(dryRunHome, 'profiles/web/package.json'), 'utf8').includes('stale-fixture'), true)
})

test('adds only the named bundle with --bundle', () => {
  writeJson(join(profileDirectory(), 'package.json'), { dependencies: {}, dsh: { profile: { bundles: [] } } })
  const output = execFileSync(process.execPath, [script, '--profile', 'web', '--home', home, '--bundle', '@dshfiles/memory', '--dry-run'], { encoding: 'utf8' })
  assert.match(output, /^ {2}\+ @dshfiles\/memory$/m)
})
