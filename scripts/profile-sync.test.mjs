import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { parse } from 'yaml'

const { packageManager } = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8'))
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
    packageManager,
    dependencies: Object.fromEntries(bundles.map(name => [`@dshfiles/${name}`, `link:../../plugins/@dshfiles/${name}`])),
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', ...bundles.map(name => `@dshfiles/${name}`)] } },
  })
const syncWithEnv = (env, ...args) => {
  const result = spawnSync(process.execPath, [script, '--profile', 'web', '--home', home, '--seed', seedDirectory, ...args], { encoding: 'utf8', env })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}
const sync = (...args) => syncWithEnv(process.env, ...args)

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

test('warns about a linked bundle only when a source it was built from changed', () => {
  const directory = join(root, 'checkout/plugins/@dshfiles/alpha')
  const sourcePath = join(directory, 'src/host.ts')
  const bundlePath = join(directory, 'dist/index.js')
  writeJson(join(directory, 'package.json'), { name: '@dshfiles/alpha', version: '0.0.0', scripts: { build: 'dshx build' } })
  write(sourcePath, 'export const value = 1\n')
  write(bundlePath, 'export const value = 1\n')
  writeJson(join(directory, 'dist/index.js.deps.json'), {
    version: 1,
    face: 'host',
    sources: ['src/host.ts'],
    hashes: { 'src/host.ts': createHash('sha256').update('export const value = 1\n').digest('hex') },
  })
  const builtAt = new Date(Date.now() - 60_000)
  utimesSync(bundlePath, builtAt, builtAt)

  const rewritten = sync()
  assert.equal(rewritten.status, 0, rewritten.output)
  assert.doesNotMatch(rewritten.output, /older than their sources/)

  write(sourcePath, 'export const value = 2\n')
  const changed = sync()
  assert.equal(changed.status, 0, changed.output)
  assert.match(changed.output, /older than their sources and DSH will load the old code: @dshfiles\/alpha$/m)
})

test('adds only the named bundle with --bundle', () => {
  writeJson(join(profileDirectory(), 'package.json'), { dependencies: {}, dsh: { profile: { bundles: [] } } })
  const output = execFileSync(process.execPath, [script, '--profile', 'web', '--home', home, '--bundle', '@dshfiles/memory', '--dry-run'], { encoding: 'utf8' })
  assert.match(output, /^ {2}\+ @dshfiles\/memory$/m)
})

test('adds the owned bundles a named bundle keeps external with --bundle', () => {
  writeJson(join(profileDirectory(), 'package.json'), { dependencies: {}, dsh: { profile: { bundles: [] } } })
  const output = execFileSync(process.execPath, [script, '--profile', 'web', '--home', home, '--bundle', '@dshfiles/memory', '--dry-run'], { encoding: 'utf8' })
  assert.match(output, /^ {2}\+ @dshfiles\/input-trigger$/m)
  assert.match(output, /^ {2}\+ @dshfiles\/shared-runtime$/m)
})

test('refuses to push every owned bundle into a dsh-superagent profile, but allows one named bundle', () => {
  const superagentHome = join(root, 'superagent-home')
  const manifestPath = join(superagentHome, 'profiles/superagent/package.json')
  writeJson(manifestPath, { dependencies: { 'dsh-superagent': 'link:/opt/dsh-superagent' }, dsh: { profile: { bundles: ['dsh-superagent'] } } })
  const run = (...args) =>
    spawnSync(process.execPath, [script, '--profile', 'superagent', '--home', superagentHome, '--dry-run', ...args], { encoding: 'utf8' })
  const refused = run()
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /runs dsh-superagent, which keeps a stock DSH profile/)
  const named = run('--bundle', '@dshfiles/memory')
  assert.equal(named.status, 0, named.stderr)
  assert.match(named.stdout, /^ {2}\+ @dshfiles\/memory$/m)
})

const stockHeader = '# Your patch layer for this dsh profile, applied after every bundle layer:\n[]\n'

test("appends the managed region to DSH's stock empty patch without leaving two documents", () => {
  // DSH writes `[]` on first start, before the seed can be copied; block rows after it are a second YAML document.
  writeJson(join(profileDirectory(), 'package.json'), { dependencies: {}, dsh: { profile: { bundles: [] } } })
  write(join(profileDirectory(), 'cordis.patch.yml'), stockHeader)
  const result = sync()
  assert.equal(result.status, 0, result.output)
  const patch = readFileSync(join(profileDirectory(), 'cordis.patch.yml'), 'utf8')
  assert.doesNotMatch(patch, /^\[\]/m)
  assert.equal(patch, `# Your patch layer for this dsh profile, applied after every bundle layer:\n\n${patchRegion}`)
})

test('repairs a profile an earlier sync left with the stock empty root above its region', () => {
  writeJson(join(profileDirectory(), 'package.json'), { dependencies: {}, dsh: { profile: { bundles: [] } } })
  write(join(profileDirectory(), 'cordis.patch.yml'), `${stockHeader}\n${patchRegion}`)
  const result = sync()
  assert.equal(result.status, 0, result.output)
  const patch = readFileSync(join(profileDirectory(), 'cordis.patch.yml'), 'utf8')
  assert.doesNotMatch(patch, /^\[\]/m)
  assert.match(patch, /# BEGIN NIX-MANAGED DSH PLUGINS\n- id: managed\n/)
})

test('keeps an empty root when nothing follows it', () => {
  writeJson(join(profileDirectory(), 'package.json'), { dependencies: {}, dsh: { profile: { bundles: [] } } })
  write(join(seedDirectory, 'cordis.patch.yml'), '[]\n')
  write(join(profileDirectory(), 'cordis.patch.yml'), stockHeader)
  assert.equal(sync().status, 0)
  assert.equal(readFileSync(join(profileDirectory(), 'cordis.patch.yml'), 'utf8'), stockHeader)
})

test('reinstalls when a linked dependency is missing from node_modules', () => {
  assert.equal(sync().status, 0)
  const modules = join(profileDirectory(), 'node_modules')
  const unrelated = join(modules, 'unrelated/package.json')
  const lockfile = join(profileDirectory(), 'pnpm-lock.yaml')
  const beforeLockfile = readFileSync(lockfile, 'utf8')
  write(unrelated, '{"name":"unrelated"}\n')
  rmSync(join(modules, '@dshfiles/alpha'), { recursive: true, force: true })

  const preview = sync('--dry-run')
  assert.equal(preview.status, 0, preview.output)
  assert.match(preview.output, /would repair missing local links without pnpm install/)
  assert.ok(!existsSync(join(modules, '@dshfiles/alpha')))

  const result = sync()
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /restored missing local links without pnpm install: @dshfiles\/alpha/)
  assert.doesNotMatch(result.output, /^profile-sync: pnpm install in /m)
  assert.ok(existsSync(join(modules, '@dshfiles/alpha/package.json')))
  assert.ok(existsSync(join(modules, '@dshfiles/beta/package.json')))
  assert.equal(readFileSync(unrelated, 'utf8'), '{"name":"unrelated"}\n')
  assert.equal(readFileSync(lockfile, 'utf8'), beforeLockfile)

  const unchanged = sync()
  assert.equal(unchanged.status, 0, unchanged.output)
  assert.match(unchanged.output, /is up to date/)
  assert.doesNotMatch(unchanged.output, /pnpm install/)
})

test('repairs a missing link without pruning node_modules after the user changes nodeLinker', () => {
  write(join(seedDirectory, 'pnpm-workspace.yaml'), 'nodeLinker: hoisted\n')
  const env = { ...process.env, CI: 'true' }
  const first = syncWithEnv(env)
  assert.equal(first.status, 0, first.output)
  const modules = join(profileDirectory(), 'node_modules')
  const metadata = join(modules, '.modules.yaml')
  const installedLayout = readFileSync(metadata, 'utf8')
  assert.equal(parse(installedLayout).nodeLinker, 'hoisted')
  const config = join(profileDirectory(), 'pnpm-workspace.yaml')
  write(config, 'nodeLinker: isolated\n')
  const unrelated = join(modules, 'unrelated/package.json')
  write(unrelated, '{"name":"unrelated"}\n')
  const link = join(modules, '@dshfiles/alpha')
  rmSync(link, { recursive: true, force: true })

  const result = syncWithEnv(env)
  assert.equal(readFileSync(unrelated, 'utf8'), '{"name":"unrelated"}\n', result.output)
  assert.equal(readFileSync(metadata, 'utf8'), installedLayout)
  assert.equal(readFileSync(config, 'utf8'), 'nodeLinker: isolated\n')
  assert.equal(result.status, 0, result.output)
  assert.equal(realpathSync(link), join(root, 'checkout/plugins/@dshfiles/alpha'))
})

test('refuses to overwrite an occupied path for a missing declared link', () => {
  assert.equal(sync().status, 0)
  const destination = join(profileDirectory(), 'node_modules/@dshfiles/alpha')
  rmSync(destination, { recursive: true, force: true })
  const marker = join(destination, 'keep.txt')
  write(marker, 'keep me\n')

  const result = sync()
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /Cannot repair @dshfiles\/alpha: .*already exists/)
  assert.doesNotMatch(result.output, /^profile-sync: pnpm install in /m)
  assert.equal(readFileSync(marker, 'utf8'), 'keep me\n')
})

test('reports a local package still missing after pnpm exits successfully', () => {
  assert.equal(sync().status, 0)
  // A changed manifest still takes the ordinary install path, where pnpm may report success for an unusable link.
  writeJson(join(profileDirectory(), 'package.json'), { ...readProfile(), description: 'Changed profile' })
  const sourceManifest = join(root, 'checkout/plugins/@dshfiles/alpha/package.json')
  rmSync(sourceManifest)

  const result = sync()
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /^profile-sync: pnpm install in /m)
  assert.match(result.output, /still missing after pnpm install: @dshfiles\/alpha/)
  assert.doesNotMatch(result.output, /profile-sync: installed in/)
})
