import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, test } from 'vitest'
import { GraphPage } from './graph-page.js'

const fixture = async () => {
  const home = await mkdtemp(join(tmpdir(), 'dshfiles-graph-page-'))
  const repository = join(home, 'repo')
  await mkdir(repository)
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const jj = (args: readonly string[]) => {
    const result = spawnSync('jj', ['--color=never', '--no-pager', ...args], {
      cwd: repository,
      env: { PATH: process.env.PATH ?? '', HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 1_000_000,
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  jj(['git', 'init', '--no-colocate'])
  jj(['config', 'set', '--repo', 'user.name', 'Graph Test'])
  jj(['config', 'set', '--repo', 'user.email', 'graph@example.invalid'])
  const commitId = (revision = '@') => jj(['--ignore-working-copy', 'log', '--no-graph', '-r', revision, '-T', 'commit_id'])
  return { jj, commitId }
}

test('graph pages exclude seen IDs and text search reaches history outside the loaded page', async () => {
  const { jj, commitId } = await fixture()
  let historicalMatchId = ''
  for (let index = 0; index < 8; index += 1) {
    jj(['new', '@', '-m', index === 2 ? 'needle in the old history' : `revision ${index}`])
    if (index === 2) historicalMatchId = commitId()
  }

  const firstPage = jj(['--ignore-working-copy', 'log', '--no-graph', '--limit', '3', '--revisions', GraphPage.revset(''), '-T', 'commit_id ++ "\\n"'])
    .split('\n')
    .filter(Boolean)
  const secondPage = jj([
    '--ignore-working-copy',
    'log',
    '--no-graph',
    '--limit',
    '3',
    '--revisions',
    `all() ~ (${GraphPage.commitIdsRevset(firstPage)})`,
    '-T',
    'commit_id ++ "\\n"',
  ])
    .split('\n')
    .filter(Boolean)

  assert.equal(firstPage.length, 3)
  assert.equal(secondPage.length, 3)
  assert.equal(new Set([...firstPage, ...secondPage]).size, 6)
  assert.ok(!secondPage.some(id => firstPage.includes(id)))

  const historicalMatch = jj([
    '--ignore-working-copy',
    'log',
    '--no-graph',
    '--limit',
    '3',
    '--revisions',
    GraphPage.revset('needle'),
    '-T',
    'commit_id ++ "\\n"',
  ])
    .split('\n')
    .filter(Boolean)
  assert.ok(!firstPage.includes(historicalMatchId))
  assert.ok(historicalMatch.includes(historicalMatchId))
})

test('next page skips loaded revisions without growing the revset and keeps graph order', async () => {
  const { jj } = await fixture()
  for (let index = 0; index < 9; index += 1) jj(['new', '@', '-m', `revision ${index}`])
  const listAll = (limit: number): string[] =>
    jj(['--ignore-working-copy', 'log', '--no-graph', '--limit', String(limit), '--revisions', GraphPage.revset(''), '-T', 'commit_id ++ "\\n"'])
      .split('\n')
      .filter(Boolean)
  const everything = listAll(100)
  const loaded = everything.slice(0, 4)
  const scanLimit = loaded.length + 3
  const next = GraphPage.nextCandidates({ listedCommitIds: listAll(scanLimit), excludeCommitIds: loaded, size: 3, scanLimit })

  assert.deepEqual(next.commitIds, everything.slice(4, 7))
  assert.equal(next.listingTruncated, true)
  const read = jj(['--ignore-working-copy', 'log', '--no-graph', '--revisions', GraphPage.commitIdsRevset(next.commitIds), '-T', 'commit_id ++ "\\n"'])
    .split('\n')
    .filter(Boolean)
  assert.deepEqual(read, everything.slice(4, 7))

  const tail = GraphPage.nextCandidates({ listedCommitIds: everything, excludeCommitIds: everything.slice(0, -2), size: 5, scanLimit: everything.length + 5 })
  assert.deepEqual(tail.commitIds, everything.slice(-2))
  assert.equal(tail.listingTruncated, false)
})

test('graph pages find revisions by displayed and canonical IDs', async () => {
  const { jj, commitId } = await fixture()
  let targetCommitId = ''
  for (let index = 0; index < 8; index += 1) {
    jj(['new', '@', '-m', `revision ${index}`])
    if (index === 2) targetCommitId = commitId()
  }
  const targetChangeId = jj(['--ignore-working-copy', 'log', '--no-graph', '-r', targetCommitId, '-T', 'change_id.normal_hex()'])
  const targetFullChangeId = jj(['--ignore-working-copy', 'log', '--no-graph', '-r', targetCommitId, '-T', 'change_id.short(64)'])
  const targetChangeIdPrefix = targetFullChangeId.slice(0, 8)
  const matchesFor = (query: string): string[] =>
    jj(['--ignore-working-copy', 'log', '--no-graph', '--revisions', GraphPage.revset(query), '-T', 'commit_id ++ "\\n"'])
      .split('\n')
      .filter(Boolean)

  for (const query of [targetChangeIdPrefix, targetChangeIdPrefix.toUpperCase(), targetFullChangeId, targetChangeId, targetCommitId]) {
    assert.ok(matchesFor(query).includes(targetCommitId), `query ${query} should find its revision`)
  }
})

test('graph search quotes user text before building a revset', async () => {
  const { jj, commitId } = await fixture()
  jj(['new', '@', '-m', 'literal needle") | all()'])
  const target = commitId()
  const matches = jj(['--ignore-working-copy', 'log', '--no-graph', '--revisions', GraphPage.revset('needle") | all()'), '-T', 'commit_id ++ "\\n"'])
    .split('\n')
    .filter(Boolean)
  assert.deepEqual(matches, [target])
})
