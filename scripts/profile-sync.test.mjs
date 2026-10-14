import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const script = join(import.meta.dirname, 'profile-sync.ts')
const seed = JSON.parse(readFileSync(join(import.meta.dirname, '../profiles/web/package.json'), 'utf8'))
const seedOwnedBundles = seed.dsh.profile.bundles.filter(name => name.startsWith('@dshfiles/'))

const dryRun = args => {
  const home = mkdtempSync(join(tmpdir(), 'profile-sync-test-'))
  try {
    mkdirSync(join(home, 'profiles/web'), { recursive: true })
    const installed = {
      dependencies: { dshmarket: '^1.0.0', '@dshfiles/optmem': 'link:/elsewhere/optmem' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dshmarket', '@dshfiles/optmem'] } },
    }
    writeFileSync(join(home, 'profiles/web/package.json'), JSON.stringify(installed))
    return execFileSync(process.execPath, [script, '--profile', 'web', '--home', home, '--dry-run', ...args], { encoding: 'utf8' })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

test('syncs exactly the seed bundles into a seeded profile', () => {
  assert.ok(!seedOwnedBundles.includes('@dshfiles/optmem'))
  const output = dryRun([])
  assert.match(output, /from the web seed/)
  assert.match(output, /^ {2}- @dshfiles\/optmem$/m)
  const added = output
    .split('\n')
    .filter(line => line.startsWith('  + '))
    .map(line => line.slice(4))
  assert.deepEqual(added, seedOwnedBundles)
})

test('adds only the named bundle with --bundle', () => {
  const output = dryRun(['--bundle', '@dshfiles/memory'])
  assert.match(output, /^ {2}\+ @dshfiles\/memory$/m)
  assert.doesNotMatch(output, /- @dshfiles\/optmem/)
})
