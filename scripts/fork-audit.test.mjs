import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { auditFork } from './fork-audit.mjs'

const policy = { schemaVersion: 1, plugins: {}, forkOnlyPaths: ['personal/'] }

function fixture(t) {
  const parent = resolve(tmpdir())
  const repo = mkdtempSync(join(parent, 'dsh-fork-audit-'))
  t.after(() => {
    assert.equal(dirname(resolve(repo)), parent)
    assert.ok(repo.startsWith(join(parent, 'dsh-fork-audit-')))
    rmSync(repo, { recursive: true, force: true })
  })
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const put = (path, text = '{}\n') => {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  const save = message => {
    git('add', '.')
    git('commit', '-m', message)
  }
  git('init', '-b', 'main')
  git('config', 'user.name', 'Fork audit fixture')
  git('config', 'user.email', 'fork-audit@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  put('plugins/@dshfiles/shared/package.json')
  save('base')
  git('branch', 'base')
  git('branch', 'upstream')
  return { repo, git, put, save, audit: (selectedPolicy = policy) => auditFork({ repo, upstream: 'upstream', policy: selectedPolicy }) }
}

test('identical refs are shared, not personally owned', t => {
  const f = fixture(t)
  const result = f.audit()
  assert.equal(result.base, result.upstream)
  assert.equal(result.dirtyStatus, '')
  assert.equal(result.plugins[0].ownership, 'shared')
  assert.equal(result.plugins[0].differsFromUpstream, false)
})

test('three-way audit detects shared overlaps, new plugin decisions and non-plugin drift without writes', t => {
  const f = fixture(t)
  f.git('switch', 'upstream')
  f.put('plugins/@dshfiles/shared/upstream.txt', 'upstream\n')
  f.put('plugins/@dshfiles/upstream-new/package.json')
  f.put('plugins/@dshfiles/collision/package.json', '{"side":"upstream"}\n')
  f.save('upstream changes')
  f.git('switch', 'main')
  f.put('plugins/@dshfiles/shared/local.txt', 'local\n')
  f.put('plugins/@dshfiles/owned/package.json')
  f.put('plugins/@dshfiles/undecided/package.json')
  f.put('plugins/@dshfiles/collision/package.json', '{"side":"local"}\n')
  f.put('personal/launcher.txt', 'personal\n')
  f.put('pnpm-workspace.yaml', 'catalog: {}\n')
  f.save('local changes')
  f.put('dirty-note.txt', 'not part of committed audit\n')
  const selectedPolicy = { ...policy, plugins: { owned: { ownership: 'owned', upstreamIntent: 'candidate', reason: 'Independent local feature' } } }
  const before = f.git('status', '--short')
  const head = f.git('rev-parse', 'HEAD')
  const result = f.audit(selectedPolicy)
  const get = name => result.plugins.find(plugin => plugin.name === name)
  assert.equal(get('shared').concurrentChanges, true)
  assert.equal(get('owned').ownership, 'owned')
  assert.equal(get('owned').upstreamIntent, 'candidate')
  assert.equal(get('undecided').ownership, 'needs-classification')
  assert.equal(get('collision').nameCollision, true)
  assert.equal(get('upstream-new').inLocal, false)
  assert.equal(get('upstream-new').upstreamChanged, true)
  assert.deepEqual(result.forkOnlyPathDelta, ['personal/launcher.txt'])
  assert.ok(result.sharedFileDelta.includes('pnpm-workspace.yaml'))
  assert.match(result.dirtyStatus, /dirty-note.txt/)
  assert.equal(f.git('status', '--short'), before)
  assert.equal(f.git('rev-parse', 'HEAD'), head)
})

test('upstream adoption flags stale ownership and local deletions remain visible', t => {
  const f = fixture(t)
  f.git('rm', 'plugins/@dshfiles/shared/package.json')
  f.save('delete shared locally')
  const result = f.audit({ ...policy, plugins: { shared: { ownership: 'owned', upstreamIntent: 'accepted', reason: 'Stale entry for review' } } })
  assert.equal(result.plugins[0].ownershipReview, true)
  assert.equal(result.plugins[0].inLocal, false)
  assert.equal(result.plugins[0].localChanged, true)
})

test('unrelated and criss-cross history fail closed', t => {
  const f = fixture(t)
  const tree = f.git('rev-parse', 'base^{tree}')
  const base = f.git('rev-parse', 'base')
  const make = (message, parents = []) => f.git('commit-tree', tree, ...parents.flatMap(parent => ['-p', parent]), '-m', message)
  const unrelated = make('unrelated root')
  assert.throws(() => auditFork({ repo: f.repo, upstream: unrelated, policy }))
  const left = make('left', [base])
  const right = make('right', [base])
  const leftMerge = make('left merge', [left, right])
  const rightMerge = make('right merge', [right, left])
  assert.throws(() => auditFork({ repo: f.repo, local: leftMerge, upstream: rightMerge, policy }), /exactly one merge base/)
})

test('invalid refs and policies fail closed', t => {
  const f = fixture(t)
  assert.throws(() => auditFork({ repo: f.repo, upstream: 'missing-ref', policy }))
  assert.throws(() => auditFork({ repo: f.repo, upstream: '--all', policy }))
  assert.throws(() => f.audit({ ...policy, plugins: { bad: { ownership: 'mine' } } }), /Invalid ownership/)
  assert.throws(() => f.audit({ ...policy, forkOnlyPaths: ['../outside'] }), /repository-relative/)
})
