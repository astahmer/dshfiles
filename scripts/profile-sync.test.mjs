import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
const sync = (...args) => {
  const result = spawnSync(process.execPath, [script, '--profile', 'web', '--home', home, '--seed', seedDirectory, ...args], { encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

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
  // An edit to a row the seed declares stays the seed's: the region is restored as shipped.
  write(join(profileDirectory(), 'cordis.patch.yml'), `- id: user-entry\n${patchRegion.replace('- id: managed', '- id: managed\n  disabled: true')}`)
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

// DSH's Settings append a row at the end of the patch, which is inside the managed region when that region ends the
// file; replacing the region wholesale then lost MCP servers and UI preferences without a word (2026-11-18).
const patchPath = () => join(profileDirectory(), 'cordis.patch.yml')
const readPatch = () => readFileSync(patchPath(), 'utf8')
const seedPatch = text => write(join(seedDirectory, 'cordis.patch.yml'), text)
const region = (...rows) => `# BEGIN NIX-MANAGED DSH PLUGINS\n${rows.join('')}# END NIX-MANAGED DSH PLUGINS\n`
const mcpRow = '- id: mcp-servers\n  name: "@dshfiles/mcp-servers"\n  config:\n    servers:\n      - id: local\n        transport: stdio\n'
const stylesRow = '- id: ui-styles\n  config:\n    preset: warm-stone\n'
const keptHeader = '# Rows saved inside the managed region, moved here by profile-sync: it rewrites only that region.'

test('moves rows saved inside the managed region below it instead of dropping them', () => {
  assert.equal(sync().status, 0)
  write(patchPath(), `- id: user-entry\n${region('- id: managed\n', mcpRow, stylesRow)}`)

  const result = sync()
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /kept 2 rows saved inside the managed region below it: mcp-servers, ui-styles$/m)
  const patch = readPatch()
  assert.equal(patch, `- id: user-entry\n${patchRegion}\n${keptHeader}\n${mcpRow}${stylesRow}`)
  assert.equal(patch.split('- id: mcp-servers').length, 2)

  const again = sync()
  assert.equal(again.status, 0, again.output)
  assert.match(again.output, /is up to date/)
  assert.equal(readPatch(), patch)
})

test('a later seed update keeps rows moved out of the region', () => {
  assert.equal(sync().status, 0)
  write(patchPath(), region('- id: managed\n', mcpRow))
  assert.equal(sync().status, 0)
  seedPatch(`- id: seeded\n${region('- id: managed\n', '- id: added-by-seed\n')}`)

  const result = sync()
  assert.equal(result.status, 0, result.output)
  const patch = readPatch()
  assert.ok(patch.startsWith(region('- id: managed\n', '- id: added-by-seed\n')), patch)
  assert.ok(patch.endsWith(mcpRow), patch)
  assert.equal(patch.split('- id: mcp-servers').length, 2)
})

test('keeps a whole row: nested lists, nested ids, block scalars and blank lines', () => {
  assert.equal(sync().status, 0)
  const row = [
    '- id: user-preset',
    '  config:',
    '    children:',
    '      - id: managed',
    '        disabled: true',
    '    script: !!js |-',
    '      const a = 1',
    '',
    '      return a',
    '',
  ].join('\n')
  write(patchPath(), region('- id: managed\n', row, '# END DERIVED preset-standard\n'))

  const result = sync()
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /kept 1 row saved inside the managed region below it: user-preset$/m)
  assert.ok(readPatch().endsWith(row), readPatch())
  assert.ok(readPatch().startsWith(patchRegion), readPatch())
})

test('keeps a row identified by a nested id key', () => {
  assert.equal(sync().status, 0)
  const row = "- name: '@scope/plugin'\n  id: 'named-later'\n  config: {a: 1}\n"
  write(patchPath(), region('- id: managed\n', row))
  const result = sync()
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /: named-later$/m)
  assert.ok(readPatch().endsWith(row))
})

test('drops a row the previous seed declared once the seed stops declaring it', () => {
  seedPatch(`- id: seeded\n${region('- id: managed\n', '- id: retired\n  disabled: true\n')}`)
  assert.equal(sync().status, 0)
  assert.deepEqual(JSON.parse(readFileSync(join(profileDirectory(), '.dshfiles-profile-sync.json'), 'utf8')).regionRowIds, ['managed', 'retired'])
  seedPatch(`- id: seeded\n${patchRegion}`)

  const result = sync()
  assert.equal(result.status, 0, result.output)
  assert.doesNotMatch(result.output, /kept \d+ row/)
  assert.doesNotMatch(readPatch(), /retired/)
})

test('records the seed row ids even when the profile is otherwise up to date', () => {
  assert.equal(sync().status, 0)
  const statePath = join(profileDirectory(), '.dshfiles-profile-sync.json')
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  delete state.regionRowIds
  writeJson(statePath, state)
  assert.equal(sync().status, 0)
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).regionRowIds, ['managed'])
})

test('does not duplicate a row already declared outside the region, and keeps the stray copy as a comment', () => {
  assert.equal(sync().status, 0)
  const outside = '- id: mcp-servers\n  config:\n    servers: []\n'
  write(patchPath(), `${outside}${region('- id: managed\n', mcpRow)}`)

  const result = sync()
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /warning: mcp-servers is declared both inside and outside the managed region/)
  const patch = readPatch()
  assert.equal(patch.match(/^- id: mcp-servers$/gm).length, 1)
  assert.ok(patch.startsWith(`${outside}${patchRegion}`), patch)
  for (const line of mcpRow.trimEnd().split('\n')) assert.ok(patch.includes(`\n# ${line}\n`), `${line} missing from\n${patch}`)
  assert.equal(sync().status, 0)
  assert.equal(readPatch(), patch)
})

test('an identical copy outside the region is dropped silently', () => {
  assert.equal(sync().status, 0)
  write(patchPath(), `${mcpRow}${region('- id: managed\n', mcpRow)}`)
  const result = sync()
  assert.equal(result.status, 0, result.output)
  assert.doesNotMatch(result.output, /declared both inside|kept \d+ row/)
  assert.equal(readPatch(), `${mcpRow}${patchRegion}`)
})

test('--dry-run reports the rows it would keep and writes nothing', () => {
  assert.equal(sync().status, 0)
  const before = region('- id: managed\n', mcpRow)
  write(patchPath(), before)
  const result = sync('--dry-run')
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /would keep 1 row saved inside the managed region below it: mcp-servers$/m)
  assert.equal(readPatch(), before)
})

test('reinstalls when a linked dependency is missing from node_modules', () => {
  assert.equal(sync().status, 0)
  rmSync(join(profileDirectory(), 'node_modules/@dshfiles/alpha'), { recursive: true, force: true })
  const result = sync()
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /pnpm install/)
  assert.ok(existsSync(join(profileDirectory(), 'node_modules/@dshfiles/alpha/package.json')))
})
