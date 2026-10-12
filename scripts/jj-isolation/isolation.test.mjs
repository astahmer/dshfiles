#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  addWorkspace,
  commitIdOf,
  disabledEnv,
  duplicatedChangeIds,
  enableIsolation,
  featureFilesOnDisk,
  guarded,
  head,
  jj,
  jjOk,
  mkRepo,
  overlap,
  realJj,
  resolveShim,
  workspaceHeads,
  writeFeatureFiles,
} from './harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const shimEnv = () => ({ ...process.env, JJ_ISOLATION_REAL_JJ: realJj })

const twoLeaves = () => {
  const repo = mkRepo()
  const root = dirname(repo)
  const spine = commitIdOf({ cwd: repo, revision: '@' })
  jjOk({ cwd: repo, args: ['bookmark', 'set', 'integration-spine', '-r', spine] })
  const wsA = addWorkspace({ repo, root, name: 'wsA', revision: spine })
  const wsB = addWorkspace({ repo, root, name: 'wsB', revision: spine })
  enableIsolation(repo)
  return { repo, root, spine, wsA, wsB }
}

const refused = result => {
  assert.equal(result.status, 3, `expected refusal, got exit ${result.status}: ${result.stderr}`)
  assert.match(result.stderr, /jj-isolation: refused/)
  return result.stderr
}

test('S1: two agents edit and describe independent revisions concurrently', async () => {
  const { repo, wsA, wsB } = twoLeaves()
  writeFeatureFiles({ dir: wsA, count: 5, tag: 'a' })
  writeFeatureFiles({ dir: wsB, count: 7, tag: 'b' })
  const [a, b] = await overlap([
    { file: resolveShim(), args: ['describe', '-m', 'agent A work'], cwd: wsA },
    { file: resolveShim(), args: ['describe', '-m', 'agent B work'], cwd: wsB },
  ])
  assert.equal(a.status, 0, a.stderr)
  assert.equal(b.status, 0, b.stderr)
  assert.equal(featureFilesOnDisk({ dir: wsA, tag: 'a' }), 5)
  assert.equal(featureFilesOnDisk({ dir: wsB, tag: 'b' }), 7)
  assert.deepEqual(duplicatedChangeIds(repo), [])
  const heads = workspaceHeads(repo)
  assert.notEqual(heads.wsA, heads.wsB)
})

test('S2: one agent rewrites its own revision while another holds uncommitted files', async () => {
  const { repo, wsA, wsB } = twoLeaves()
  writeFeatureFiles({ dir: wsB, count: 18, tag: 'b' })
  const foreignBefore = head(wsB)
  const result = guarded({ cwd: wsA, args: ['describe', '-m', 'agent A rewrote itself'] })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(head(wsB), foreignBefore, 'a sibling workspace rewrite changed a foreign working-copy revision')
  assert.equal(featureFilesOnDisk({ dir: wsB, tag: 'b' }), 18)
  assert.deepEqual(duplicatedChangeIds(repo), [])
})

test('S3: rewriting an ancestor another workspace holds as @ is refused', async () => {
  const repo = mkRepo()
  const root = dirname(repo)
  const spine = commitIdOf({ cwd: repo, revision: '@' })
  const wsMid = addWorkspace({ repo, root, name: 'wsMid', revision: spine })
  const midHead = commitIdOf({ cwd: wsMid, revision: '@' })
  const wsVictim = addWorkspace({ repo, root, name: 'wsVictim', revision: midHead })
  enableIsolation(repo)
  writeFeatureFiles({ dir: wsVictim, count: 18, tag: 'v' })
  const victimHeadBefore = head(wsVictim)

  const stderr = refused(guarded({ cwd: repo, args: ['describe', '-r', midHead, '-m', 'rewrite the middle'] }))
  assert.match(stderr, /foreign-working-copy-rewrite/)
  assert.match(stderr, /wsVictim|wsMid/)

  assert.equal(featureFilesOnDisk({ dir: wsVictim, tag: 'v' }), 18)
  assert.equal(head(wsVictim), victimHeadBefore)
  assert.deepEqual(duplicatedChangeIds(repo), [])
})

test('S3 control: without the guard the same command diverges the victim and empties its checkout', async () => {
  const repo = mkRepo()
  const root = dirname(repo)
  const spine = commitIdOf({ cwd: repo, revision: '@' })
  const wsMid = addWorkspace({ repo, root, name: 'wsMid', revision: spine })
  const midHead = commitIdOf({ cwd: wsMid, revision: '@' })
  const wsVictim = addWorkspace({ repo, root, name: 'wsVictim', revision: midHead })
  writeFeatureFiles({ dir: wsVictim, count: 18, tag: 'v' })

  const [victim, other] = await overlap([
    { file: resolveShim(), args: ['describe', '-m', 'victim work'], cwd: wsVictim, env: disabledEnv },
    { file: resolveShim(), args: ['describe', '-r', midHead, '-m', 'other agent'], cwd: repo, env: disabledEnv },
  ])
  assert.equal(victim.status, 0, victim.stderr)
  assert.equal(other.status, 0, other.stderr)

  const next = guarded({ cwd: wsVictim, args: ['status'], env: { JJ_ISOLATION: 'off' } })
  assert.match(`${next.stdout}${next.stderr}`, /Concurrent modification detected/)
  assert.match(`${next.stdout}${next.stderr}`, /Updated working copy to fresh commit/)
  assert.ok(duplicatedChangeIds(repo).length > 0, 'expected a divergent change id')
  assert.ok(featureFilesOnDisk({ dir: wsVictim, tag: 'v' }) < 18, 'expected the working copy to lose the files')
})

test('S4: integration while another agent edits leaves the editor untouched', async () => {
  const { repo, wsA, spine } = twoLeaves()
  writeFeatureFiles({ dir: wsA, count: 12, tag: 'a' })
  const headBefore = head(wsA)

  const source = commitIdOf({ cwd: wsA, revision: '@' })
  const duplicate = jj({ cwd: repo, args: ['duplicate', source, '--onto', 'integration-spine', '--ignore-working-copy'] })
  assert.equal(duplicate.status, 0, duplicate.stderr)
  const advanced = jj({ cwd: repo, args: ['bookmark', 'set', 'integration-spine', '-r', source, '--allow-backwards'] })
  assert.equal(advanced.status, 0, advanced.stderr)

  assert.equal(head(wsA), headBefore)
  assert.equal(featureFilesOnDisk({ dir: wsA, tag: 'a' }), 12)
})

test('S4b: a monitoring read must not snapshot the workspace it watches', () => {
  const { wsA } = twoLeaves()
  writeFeatureFiles({ dir: wsA, count: 3, tag: 'a' })
  const before = head(wsA)

  jj({ cwd: wsA, args: ['log', '-r', '@', '--no-graph', '-T', 'commit_id'] })
  assert.notEqual(head(wsA), before, 'an unguarded read is expected to snapshot and rewrite @')

  const afterUnflagged = head(wsA)
  jj({ cwd: wsA, args: ['log', '-r', '@', '--no-graph', '-T', 'commit_id', '--ignore-working-copy'] })
  assert.equal(head(wsA), afterUnflagged, '--ignore-working-copy must leave @ untouched')
})

test('S5: concurrent workspace creation produces independent leaves', async () => {
  const repo = mkRepo()
  const root = dirname(repo)
  const spine = commitIdOf({ cwd: repo, revision: '@' })
  jjOk({ cwd: repo, args: ['bookmark', 'create', 'integration-spine', '-r', spine] })
  enableIsolation(repo)

  const [a, b] = await overlap([
    { file: resolveShim(), args: ['workspace', 'add', join(root, 'wsX'), '--name', 'wsX'], cwd: repo },
    { file: resolveShim(), args: ['workspace', 'add', join(root, 'wsY'), '--name', 'wsY'], cwd: repo },
  ])
  assert.equal(a.status, 0, a.stderr)
  assert.equal(b.status, 0, b.stderr)
  assert.match(a.stderr, /pin-workspace-base/)

  const heads = workspaceHeads(repo)
  const parentOf = cwd => jjOk({ cwd, args: ['log', '-r', '@-', '--no-graph', '-T', 'commit_id', '--ignore-working-copy'] })
  assert.equal(parentOf(join(root, 'wsX')), spine, 'new workspace is not a leaf of the frozen base')
  assert.equal(parentOf(join(root, 'wsY')), spine, 'new workspace is not a leaf of the frozen base')
  assert.notEqual(heads.wsX, heads.wsY)
})

test('S5b: workspace add over an existing mutable parent is repinned, never chained', () => {
  const { repo, root, wsA } = twoLeaves()
  const spine = jjOk({ cwd: wsA, args: ['log', '-r', '@-', '--no-graph', '-T', 'commit_id', '--ignore-working-copy'] })
  const result = guarded({ cwd: repo, args: ['workspace', 'add', join(root, 'wsC'), '--name', 'wsC', '-r', head(wsA)] })
  assert.equal(result.status, 0, result.stderr)
  const parent = jjOk({ cwd: join(root, 'wsC'), args: ['log', '-r', '@-', '--no-graph', '-T', 'commit_id', '--ignore-working-copy'] })
  assert.equal(parent, spine)
  assert.notEqual(parent, head(wsA))
})

test('S6: concurrent workspace cleanup requires a proof and never strands silently', async () => {
  const { repo, wsB } = twoLeaves()
  writeFeatureFiles({ dir: wsB, count: 4, tag: 'b' })
  const proofTarget = head(wsB)

  const [unproven, wrongProof] = await overlap([
    { file: resolveShim(), args: ['workspace', 'forget', 'wsB'], cwd: repo },
    { file: resolveShim(), args: ['workspace', 'forget', 'wsB'], cwd: repo, env: { JJ_ISOLATION_FORGET_PROOF: 'deadbeef' } },
  ])
  refused(unproven)
  refused(wrongProof)
  assert.ok(workspaceHeads(repo).wsB !== undefined, 'wsB must still be registered')
  assert.equal(featureFilesOnDisk({ dir: wsB, tag: 'b' }), 4)

  const proven = guarded({ cwd: repo, args: ['workspace', 'forget', 'wsB'], env: { JJ_ISOLATION_FORGET_PROOF: proofTarget } })
  assert.equal(proven.status, 0, proven.stderr)
  assert.equal(workspaceHeads(repo).wsB, undefined)
})

test('S7: workspace reuse and ownership collision leave the incumbent intact', async () => {
  const { repo, root, wsA } = twoLeaves()
  writeFeatureFiles({ dir: wsA, count: 6, tag: 'a' })
  const before = head(wsA)

  const reuse = guarded({ cwd: repo, args: ['workspace', 'add', wsA, '--name', 'wsA-clone'] })
  assert.notEqual(reuse.status, 0, 'jj must refuse a destination that already exists')

  const [first, second] = await overlap([
    { file: resolveShim(), args: ['workspace', 'add', join(root, 'dup'), '--name', 'dup'], cwd: repo },
    { file: resolveShim(), args: ['workspace', 'add', join(root, 'dup'), '--name', 'dup'], cwd: repo },
  ])
  assert.equal([first.status, second.status].filter(status => status === 0).length, 1)
  assert.equal(head(wsA), before)
  assert.equal(featureFilesOnDisk({ dir: wsA, tag: 'a' }), 6)
})

test('S8: a workspace never goes stale behind its back, so no recovery checkout fires', async () => {
  const repo = mkRepo()
  const root = dirname(repo)
  const spine = commitIdOf({ cwd: repo, revision: '@' })
  const wsMid = addWorkspace({ repo, root, name: 'wsMid', revision: spine })
  const midHead = commitIdOf({ cwd: wsMid, revision: '@' })
  const wsVictim = addWorkspace({ repo, root, name: 'wsVictim', revision: midHead })
  enableIsolation(repo)
  writeFeatureFiles({ dir: wsVictim, count: 18, tag: 'v' })
  const victimHeadBefore = head(wsVictim)

  refused(guarded({ cwd: repo, args: ['abandon', midHead] }))
  refused(guarded({ cwd: repo, args: ['rebase', '-s', midHead, '-d', 'root()'] }))
  assert.equal(head(wsVictim), victimHeadBefore, 'a refused rewrite still moved the foreign working-copy revision')

  const status = guarded({ cwd: wsVictim, args: ['status'] })
  assert.doesNotMatch(`${status.stdout}${status.stderr}`, /Updated working copy to fresh commit/)
  assert.equal(featureFilesOnDisk({ dir: wsVictim, tag: 'v' }), 18)
})

test('S9: divergence is reported non-destructively and recoverable deterministically', async () => {
  const repo = mkRepo()
  const root = dirname(repo)
  const spine = commitIdOf({ cwd: repo, revision: '@' })
  const wsMid = addWorkspace({ repo, root, name: 'wsMid', revision: spine })
  const midHead = commitIdOf({ cwd: wsMid, revision: '@' })
  const wsVictim = addWorkspace({ repo, root, name: 'wsVictim', revision: midHead })
  writeFeatureFiles({ dir: wsVictim, count: 18, tag: 'v' })

  await overlap([
    { file: resolveShim(), args: ['describe', '-m', 'victim work'], cwd: wsVictim, env: disabledEnv },
    { file: resolveShim(), args: ['describe', '-r', midHead, '-m', 'other agent'], cwd: repo, env: disabledEnv },
  ])
  jj({ cwd: wsVictim, args: ['status'] })
  assert.ok(duplicatedChangeIds(repo).length > 0)

  const recovered = guarded({ cwd: repo, args: [] })
  const report = spawnSyncGuard(['recover', '--json'], repo)
  assert.equal(report.status, 3)
  const parsed = JSON.parse(report.stdout)
  assert.equal(parsed.divergences.length, 1)
  const keeper = parsed.divergences[0].copies.sort((left, right) => right.files - left.files)[0]
  assert.ok(keeper.files >= 19, `expected the keeper copy to hold the files, got ${keeper.files}`)

  const stateBefore = duplicatedChangeIds(repo)
  assert.deepEqual(duplicatedChangeIds(repo), stateBefore, 'recover must not modify the repository')

  jj({ cwd: wsVictim, args: ['new', keeper.commitId] })
  assert.equal(featureFilesOnDisk({ dir: wsVictim, tag: 'v' }), 18)
  assert.ok(recovered.status >= 0)
})

test('S10: an agent killed mid-mutation loses no files and corrupts nothing', async () => {
  const { repo, wsA } = twoLeaves()
  writeFeatureFiles({ dir: wsA, count: 18, tag: 'a' })

  const child = spawn(resolveShim(), ['describe', '-m', 'interrupted'], { cwd: wsA, env: shimEnv(), stdio: 'ignore' })
  await sleep(45)
  child.kill('SIGKILL')
  await once(child, 'close')

  assert.equal(featureFilesOnDisk({ dir: wsA, tag: 'a' }), 18)
  const status = jj({ cwd: wsA, args: ['status', '--ignore-working-copy'] })
  assert.equal(status.status, 0, status.stderr)
  assert.deepEqual(duplicatedChangeIds(repo), [])
})

test('S11: a sweep pass may not mutate a workspace it inspects', t => {
  const jjw = jj({ cwd: process.cwd(), args: ['--version'] })
  void jjw
  const available = spawnSyncWhich('jjw')
  if (!available) {
    t.skip('jjw is not on PATH')
    return
  }
  const repo = mkRepo()
  const root = dirname(repo)
  const spine = commitIdOf({ cwd: repo, revision: '@' })
  jjOk({ cwd: repo, args: ['bookmark', 'create', 'integration-spine', '-r', spine] })
  const wsA = addWorkspace({ repo, root, name: 'wsA', revision: spine })
  writeFeatureFiles({ dir: wsA, count: 3, tag: 'a' })
  const repoHeadBefore = head(repo)
  const wsHeadBefore = head(wsA)

  const sweep = spawnSyncNode([join(here, '..', '..', 'scripts', 'jj-workspace-sweep.mjs'), '--older-than-days', '0'], repo)
  assert.equal(sweep.status, 0, sweep.stderr)
  assert.equal(head(repo), repoHeadBefore, 'the sweep mutated the invoking workspace')
  assert.equal(head(wsA), wsHeadBefore, 'the sweep mutated a candidate workspace')
  assert.equal(featureFilesOnDisk({ dir: wsA, tag: 'a' }), 3)
})

test('S12: several agents branch from the same canonical bookmark', async () => {
  const repo = mkRepo()
  const root = dirname(repo)
  const spine = commitIdOf({ cwd: repo, revision: '@' })
  jjOk({ cwd: repo, args: ['bookmark', 'create', 'integration-spine', '-r', spine] })
  enableIsolation(repo)
  const workspaces = ['ws1', 'ws2', 'ws3'].map(name => addWorkspace({ repo, root, name, revision: 'integration-spine' }))

  workspaces.forEach((dir, index) => writeFeatureFiles({ dir, count: index + 2, tag: `w${index}` }))
  const results = await overlap(
    workspaces.map((dir, index) => ({ file: resolveShim(), args: ['describe', '-m', `agent ${index} work`], cwd: dir })),
  )
  results.forEach(result => assert.equal(result.status, 0, result.stderr))
  workspaces.forEach((dir, index) => assert.equal(featureFilesOnDisk({ dir, tag: `w${index}` }), index + 2))
  assert.deepEqual(duplicatedChangeIds(repo), [])
  assert.equal(commitIdOf({ cwd: repo, revision: 'integration-spine' }), spine, 'workspaces moved the canonical bookmark')
})

test('S13: a coordinator integrating concurrently with an active editor interferes with nothing', async () => {
  const { repo, wsA, spine } = twoLeaves()
  writeFeatureFiles({ dir: wsA, count: 9, tag: 'a' })
  const before = head(wsA)

  const coordinator = async () => {
    const source = commitIdOf({ cwd: wsA, revision: '@' })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      jj({ cwd: repo, args: ['duplicate', source, '--onto', 'integration-spine', '--ignore-working-copy'] })
      jj({ cwd: repo, args: ['log', '-r', '@', '--no-graph', '-T', 'commit_id', '--ignore-working-copy'] })
      jj({ cwd: wsA, args: ['diff', '--from', '@-', '--to', '@', '--summary', '--ignore-working-copy'] })
    }
  }
  await Promise.all([coordinator(), coordinator()])

  assert.equal(head(wsA), before)
  assert.equal(featureFilesOnDisk({ dir: wsA, tag: 'a' }), 9)
  assert.deepEqual(duplicatedChangeIds(repo), [])
})

test('S14: a background operation may not touch an active workspace ancestry', async () => {
  const { repo, wsA, spine } = twoLeaves()
  writeFeatureFiles({ dir: wsA, count: 11, tag: 'a' })
  const before = head(wsA)

  const background = async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      jj({ cwd: wsA, args: ['log', '-r', '@', '--no-graph', '-T', 'commit_id', '--ignore-working-copy'] })
      jj({ cwd: wsA, args: ['diff', '--revisions', '@', '--name-only', '--ignore-working-copy'] })
    }
  }
  await background()

  refused(guarded({ cwd: repo, args: ['describe', '-r', before, '-m', 'background rewrite'] }))
  refused(guarded({ cwd: repo, args: ['squash', '--from', before, '--into', spine] }))
  refused(guarded({ cwd: repo, args: ['restore', '--changes-in', before] }))

  assert.equal(head(wsA), before)
  assert.equal(featureFilesOnDisk({ dir: wsA, tag: 'a' }), 11)
  assert.deepEqual(duplicatedChangeIds(repo), [])
})

test('S14b: repo-wide and canonical-bookmark guards hold', () => {
  const { repo, spine } = twoLeaves()
  refused(guarded({ cwd: repo, args: ['op', 'restore', '@'] }))
  refused(guarded({ cwd: repo, args: ['util', 'gc'] }))

  const ahead = guarded({ cwd: repo, args: ['bookmark', 'set', 'integration-spine', '-r', 'root()', '--allow-backwards'] })
  refused(ahead)
  assert.match(ahead.stderr, /bookmark-rewind/)
  assert.equal(commitIdOf({ cwd: repo, revision: 'integration-spine' }), spine)
})

test('S14c: an authorized override exists and is explicit', () => {
  const { repo, wsA } = twoLeaves()
  writeFeatureFiles({ dir: wsA, count: 2, tag: 'a' })
  const before = head(wsA)
  const overridden = guarded({
    cwd: repo,
    args: ['describe', '-r', before, '-m', 'authorized consolidation'],
    env: { JJ_ISOLATION_ALLOW_FOREIGN_REWRITE: '1' },
  })
  assert.equal(overridden.status, 0, overridden.stderr)
  assert.notEqual(head(wsA), before)
  assert.equal(featureFilesOnDisk({ dir: wsA, tag: 'a' }), 2)
})

import { readFileSync } from 'node:fs'

const sweepPath = () => join(here, '..', '..', 'scripts', 'jj-workspace-sweep.mjs')

test('S11b: sweep --apply is refused unless the directory state was actually proven', t => {
  if (!spawnSyncWhich('jjw')) {
    t.skip('jjw is not on PATH')
    return
  }
  const repo = mkRepo()
  const root = dirname(repo)
  const spine = commitIdOf({ cwd: repo, revision: '@' })
  jjOk({ cwd: repo, args: ['bookmark', 'set', 'integration-spine', '-r', spine] })
  const dirty = addWorkspace({ repo, root, name: 'dirty', revision: 'integration-spine' })
  writeFeatureFiles({ dir: dirty, count: 4, tag: 'd' })
  addWorkspace({ repo, root, name: 'clean', revision: 'integration-spine' })

  const dryRun = spawnSyncNode([sweepPath(), '--older-than-days', '0'], repo)
  assert.equal(dryRun.status, 0, dryRun.stderr)
  assert.match(dryRun.stdout, /keep:unproven/, 'an uninspected directory must not be sweepable')

  const unproven = spawnSyncNode([sweepPath(), '--older-than-days', '0', '--apply'], repo)
  assert.equal(unproven.status, 2)
  assert.match(unproven.stderr, /refusing --apply without --prove-clean/)
  assert.ok(workspaceHeads(repo).dirty !== undefined)

  const proven = spawnSyncNode([sweepPath(), '--older-than-days', '0', '--apply', '--prove-clean'], repo)
  assert.equal(proven.status, 0, proven.stderr)
  assert.ok(workspaceHeads(repo).dirty !== undefined, 'a workspace holding unsnapshotted files must be kept')
  assert.equal(featureFilesOnDisk({ dir: dirty, tag: 'd' }), 4)
  assert.equal(workspaceHeads(repo).clean, undefined, 'a proven-clean workspace is sweepable')
  assert.match(proven.stdout, /recovery record/)
})

test('S11c: the sweep never recommends rewriting the shared operation log', () => {
  const source = readFileSync(sweepPath(), 'utf8')
  assert.doesNotMatch(source, /op restore .*discards every agent/, 'the sweep must not print a jj op restore rollback hint')
  assert.match(source, /ignore-working-copy/, 'the sweep must read with --ignore-working-copy')
})

function spawnSyncGuard(args, cwd) {
  return spawnSync(process.execPath, [join(here, 'cli.mjs'), ...args], { cwd, encoding: 'utf8' })
}

function spawnSyncNode(args, cwd) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, JJ_ISOLATION_REAL_JJ: realJj } })
}

function spawnSyncWhich(name) {
  return spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).status === 0
}
