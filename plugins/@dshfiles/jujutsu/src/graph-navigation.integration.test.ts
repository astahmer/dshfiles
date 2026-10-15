import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, test } from 'vitest'
import { readGraphNavigation, readGraphSlice, readRevisionRelationship } from './graph-navigation-reads.js'
import type { JjRun } from './revision-reads.js'

const fixture = async () => {
  const home = await mkdtemp(join(tmpdir(), 'dshfiles-graph-'))
  const repo = join(home, 'repo')
  await mkdir(repo)
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const jj = (args: readonly string[]) => {
    const result = spawnSync('jj', ['--color=never', '--no-pager', ...args], {
      cwd: repo,
      env: { PATH: process.env.PATH ?? '', HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 4_000_000,
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  jj(['git', 'init', '--no-colocate'])
  jj(['config', 'set', '--repo', 'user.name', 'Graph Test'])
  jj(['config', 'set', '--repo', 'user.email', 'graph@example.invalid'])
  const id = (rev = '@') => jj(['--ignore-working-copy', 'log', '--no-graph', '-r', rev, '-T', 'commit_id']).trim()
  const run: JjRun = async args => ({ stdout: jj(args), truncated: false })
  return { repo, jj, id, run }
}

test('landmarks resolve exact local tips, missing remote, and do not snapshot dirty files', async () => {
  const { repo, jj, id, run } = await fixture()
  jj(['bookmark', 'create', 'main'])
  const before = id()
  const operations = jj(['op', 'log', '--no-graph', '-T', 'id'])
  await writeFile(join(repo, 'dirty'), 'unsnapshotted')
  const navigation = await readGraphNavigation(run)
  assert.equal(navigation.landmarks.find(item => item.kind === 'current')?.revisions[0]?.commitId, before)
  assert.equal(navigation.landmarks.find(item => item.kind === 'main')?.status, 'resolved')
  assert.equal(navigation.landmarks.find(item => item.kind === 'main-origin')?.status, 'missing')
  assert.equal(jj(['--ignore-working-copy', 'op', 'log', '--no-graph', '-T', 'id']), operations)
})

test('relationships count exact ancestry, connection and both common ancestors in a criss-cross DAG', async () => {
  const { jj, id, run } = await fixture()
  const base = id()
  jj(['new', base, '-m', 'left'])
  const left = id()
  jj(['new', base, '-m', 'right'])
  const right = id()
  jj(['new', left, right, '-m', 'merge one'])
  const one = id()
  jj(['new', left, right, '-m', 'merge two'])
  const two = id()
  const comparison = await readRevisionRelationship({ run, commitId: one, targetCommitId: two })
  assert.equal(comparison.relation, 'diverged')
  assert.equal(comparison.selectedOnlyCount, 1)
  assert.equal(comparison.targetOnlyCount, 1)
  assert.deepEqual(new Set(comparison.commonAncestorIds), new Set([left, right]))
  assert.deepEqual(new Set(comparison.connectionIds), new Set([left, right, one, two]))
  assert.deepEqual(comparison.differenceIds, [one])
  assert.equal(comparison.truncated, false)
  const ancestry = await readRevisionRelationship({ run, commitId: base, targetCommitId: one })
  assert.equal(ancestry.relation, 'ancestor')
  assert.equal(ancestry.targetOnlyCount, 3)
  const same = await readRevisionRelationship({ run, commitId: one, targetCommitId: one })
  assert.equal(same.relation, 'same')
  assert.equal(same.selectedOnlyCount, 0)
})

test('exclusive history preserves shared ancestors and retained descendants', async () => {
  const { jj, id, run } = await fixture()
  const base = id()
  jj(['new', base, '-m', 'left'])
  const left = id()
  jj(['new', base, '-m', 'right'])
  const exclusive = await readGraphSlice({ run, commitId: left, mode: 'exclusive' })
  assert.deepEqual(
    exclusive.revisions.map(item => item.commitId),
    [left],
  )
  const shared = await readGraphSlice({ run, commitId: base, mode: 'exclusive' })
  assert.equal(shared.revisions.length, 0)
  const history = await readGraphSlice({ run, commitId: left, mode: 'history' })
  assert.equal(history.revisions.length, 3)
})

test('all relationship reads stay pinned when another operation moves the bookmark', async () => {
  const { jj, id, run } = await fixture()
  const before = id()
  let changed = false
  const interleaved: JjRun = async (args, options) => {
    const result = await run(args, options)
    if (!changed) {
      changed = true
      jj(['new', '-m', 'concurrent'])
      jj(['bookmark', 'create', 'main'])
    }
    return result
  }
  const result = await readGraphNavigation(interleaved)
  assert.equal(result.landmarks[0]?.revisions[0]?.commitId, before)
  assert.equal(result.landmarks.find(item => item.kind === 'main')?.status, 'missing')
})

test('old landmarks outside 500 revisions resolve and bounded histories never truncate counts', async () => {
  const { jj, id, run } = await fixture()
  const base = id()
  jj(['bookmark', 'create', 'main'])
  for (let index = 0; index < 501; index += 1) jj(['new', '-m', `step ${index}`])
  const tip = id()
  const navigation = await readGraphNavigation(run)
  assert.equal(navigation.landmarks.find(item => item.kind === 'main')?.revisions[0]?.commitId, base)
  const result = await readRevisionRelationship({ run, commitId: tip, targetCommitId: base })
  assert.equal(result.selectedOnlyCount, 501)
  assert.equal(result.targetOnlyCount, 0)
  assert.equal(result.historyIds.length, 500)
  assert.equal(result.revisions.length, 500)
  assert.ok(result.revisions.some(revision => revision.commitId === base))
  assert.ok(result.revisions.some(revision => revision.commitId === tip))
  assert.equal(result.truncated, true)
  const slice = await readGraphSlice({ run, commitId: tip, mode: 'history' })
  assert.equal(slice.truncated, true)
}, 120_000)

test('Default resolves default workspace rather than current workspace or main', async () => {
  const { repo, jj, id } = await fixture()
  const defaultCommit = id()
  const alternate = join(repo, '..', 'alternate')
  jj(['workspace', 'add', alternate, '--name', 'alternate', '-r', 'root()'])
  const run: JjRun = async args => ({ stdout: jj(['-R', alternate, ...args]), truncated: false })
  const navigation = await readGraphNavigation(run)
  assert.equal(navigation.landmarks.find(item => item.kind === 'default')?.revisions[0]?.commitId, defaultCommit)
  assert.notEqual(navigation.landmarks.find(item => item.kind === 'current')?.revisions[0]?.commitId, defaultCommit)
})

test('concurrent conflicting main bookmark reports every target as ambiguous', async () => {
  const { jj, id, run } = await fixture()
  const base = id()
  jj(['new', base, '-m', 'left'])
  const left = id()
  jj(['new', base, '-m', 'right'])
  const right = id()
  const operation = jj(['op', 'log', '--limit', '1', '--no-graph', '-T', 'id']).trim()
  jj(['bookmark', 'create', 'main', '-r', left])
  jj(['--at-operation', operation, 'bookmark', 'create', 'main', '-r', right])
  jj(['status'])
  const navigation = await readGraphNavigation(run)
  const main = navigation.landmarks.find(item => item.kind === 'main')
  assert.equal(main?.status, 'ambiguous')
  assert.deepEqual(new Set(main?.revisions.map(revision => revision.commitId)), new Set([left, right]))
})

test('rejects revset injection before running a command', async () => {
  const { run } = await fixture()
  await assert.rejects(readRevisionRelationship({ run, commitId: 'all()', targetCommitId: 'a'.repeat(40) }))
})
