#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  addWorkspace,
  commitIdOf,
  enableIsolation,
  featureFilesOnDisk,
  guarded,
  head,
  jjOk,
  mkRepo,
  realJj,
  workspaceHeads,
  writeFeatureFiles,
} from './harness.mjs'
import { directoryFingerprint } from './migrate.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const CLI = join(here, 'cli.mjs')

const cli = (args, cwd, env = {}) =>
  spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, JJ_ISOLATION_REAL_JJ: realJj, ...env },
  })

const armedGate = cwd => {
  const result = cli(['maintenance', 'arm', '--quiet-seconds', '0', '--ttl-minutes', '30', '--json'], cwd)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

/**
 * The incident topology: `spine -> mid slot -> top slot`, with `top` doing its
 * own work above its slot. `mid` therefore has a live foreign working copy above
 * it, and `top` is a leaf that already holds unlanded work.
 */
const foldedLine = () => {
  const repo = mkRepo()
  const root = dirname(repo)
  const spine = commitIdOf({ cwd: repo, revision: '@' })
  jjOk({ cwd: repo, args: ['bookmark', 'set', 'integration-spine', '-r', spine] })
  const mid = addWorkspace({ repo, root, name: 'mid', revision: spine })
  const midHead = commitIdOf({ cwd: mid, revision: '@' })
  const top = addWorkspace({ repo, root, name: 'top', revision: midHead })
  writeFeatureFiles({ dir: top, count: 3, tag: 't' })
  jjOk({ cwd: top, args: ['describe', '-m', 'top own work'] })
  enableIsolation(repo)
  return { repo, root, spine, mid, midHead, top }
}

test('preflight is read-only and reports the migration order, blockers and graft warnings', () => {
  const { repo, mid, top } = foldedLine()
  writeFeatureFiles({ dir: mid, count: 2, tag: 'm' })
  const midHeadBefore = head(mid)
  const headsBefore = JSON.stringify(workspaceHeads(repo))

  const result = cli(['preflight', '--json', '--quiet-seconds', '0'], repo)
  assert.equal(result.status, 0, result.stderr)
  const preflight = JSON.parse(result.stdout)
  assert.equal(JSON.stringify(workspaceHeads(repo)), headsBefore, 'preflight must not move any working-copy revision')
  assert.equal(head(mid), midHeadBefore, 'preflight must not snapshot')

  const topEntry = preflight.workspaces.find(entry => entry.name === 'top')
  const midEntry = preflight.workspaces.find(entry => entry.name === 'mid')
  assert.equal(preflight.workspacePathSource, 'jjw')
  assert.equal(topEntry.proposedMode, 'leaf-from-current')
  assert.equal(topEntry.graftPathCount, 3, 'the leaf must carry the workspace own work')
  assert.equal(topEntry.warnings.length, 1)
  assert.match(topEntry.warnings[0], /would ADD 3 new path/)
  assert.equal(topEntry.graftExistingCount, 0)
  assert.equal(
    midEntry.blockers.some(blocker => blocker.includes('live foreign working-copy descendant')),
    true,
    'the workspace with a live foreign child above it must be blocked',
  )
  assert.equal(preflight.order[0], 'top', 'the tip must be migrated first')
  assert.equal(preflight.order.includes('default'), false, 'the repository root checkout is not a migration candidate')
  void top
})

test('maintenance arm refuses while operations are recent, then fences every workspace of the store', () => {
  const { repo, mid } = foldedLine()
  writeFeatureFiles({ dir: mid, count: 2, tag: 'm' })

  const notQuiet = cli(['maintenance', 'arm', '--quiet-seconds', '3600'], repo)
  assert.equal(notQuiet.status, 3)
  assert.match(notQuiet.stderr, /not quiet/)

  const gate = armedGate(repo)
  assert.ok(gate.token.length > 0)

  const blocked = guarded({ cwd: mid, args: ['describe', '-m', 'should not land'] })
  assert.equal(blocked.status, 3, `expected a maintenance refusal, got: ${blocked.stderr}`)
  assert.match(blocked.stderr, /maintenance-active/)

  const readAllowed = guarded({ cwd: mid, args: ['log', '-r', '@', '--no-graph', '-T', 'commit_id', '--ignore-working-copy'] })
  assert.equal(readAllowed.status, 0, readAllowed.stderr)

  const withToken = guarded({ cwd: mid, args: ['status'], env: { JJ_ISOLATION_MAINTENANCE_TOKEN: gate.token } })
  assert.equal(withToken.status, 0, withToken.stderr)

  assert.match(cli(['maintenance', 'status'], repo).stdout, /ARMED/)
  assert.equal(cli(['maintenance', 'disarm', '--token', 'nope'], repo).status, 3)
  assert.equal(cli(['maintenance', 'disarm', '--token', gate.token], repo).status, 0)
  // The fence is gone, but the isolation rule still refuses a rewrite of the
  // live working copy above `mid`.
  const afterDisarm = guarded({ cwd: mid, args: ['describe', '-m', 'still foreign'] })
  assert.equal(afterDisarm.status, 3)
  assert.match(afterDisarm.stderr, /foreign-working-copy-rewrite/)
  assert.equal(guarded({ cwd: mid, args: ['status'] }).status, 0)
})

test('migrate refuses without the maintenance fence', () => {
  const { repo } = foldedLine()
  const result = cli(['migrate', 'top', '--base', 'integration-spine', '--apply', '--accept-graft'], repo)
  assert.equal(result.status, 3)
  assert.match(result.stderr, /maintenance mode is not armed/)
})

test('the graft acknowledgement is required and the leaf preserves the working directory', () => {
  const { repo, top, mid, midHead } = foldedLine()
  const { token } = armedGate(repo)
  const before = directoryFingerprint(top)
  const env = { JJ_ISOLATION_MAINTENANCE_TOKEN: token }

  const unacked = JSON.parse(cli(['migrate', 'top', '--base', 'integration-spine'], repo, env).stdout).plan
  assert.equal(unacked.blockers.some(blocker => blocker.includes('graft')), true)
  assert.equal(cli(['migrate', 'top', '--base', 'integration-spine', '--apply'], repo, env).status, 3)

  const plan = JSON.parse(cli(['migrate', 'top', '--base', 'integration-spine', '--accept-graft'], repo, env).stdout).plan
  assert.equal(plan.mode, 'leaf-from-current')
  assert.deepEqual(plan.blockers, [])
  assert.equal(plan.warnings.length, 1)

  const applied = cli(['migrate', 'top', '--base', 'integration-spine', '--apply', '--accept-graft'], repo, env)
  assert.equal(applied.status, 0, applied.stderr)
  const outcome = JSON.parse(applied.stdout).applied
  assert.equal(outcome.directoryDigestStable, true)
  assert.equal(outcome.leafHasNoDescendants, true)
  assert.equal(directoryFingerprint(top), before, 'migration changed the working directory')

  const heads = workspaceHeads(repo)
  assert.equal(heads.mid, midHead, 'a foreign working copy moved')
  assert.equal(Object.keys(heads).some(key => key.startsWith('mig-')), false, 'the scratch workspace must be forgotten')

  const leafParent = jjOk({ cwd: top, args: ['log', '-r', '@-', '--no-graph', '-T', 'commit_id', '--ignore-working-copy'] })
  assert.equal(
    leafParent,
    jjOk({ cwd: repo, args: ['log', '-r', 'integration-spine', '--no-graph', '-T', 'commit_id', '--ignore-working-copy'] }),
  )
  const own = jjOk({ cwd: repo, args: ['diff', '--from', 'integration-spine', '--to', outcome.after, '--name-only', '--ignore-working-copy'] })
  assert.match(own, /feature-t1\.txt/)

  jjOk({ cwd: top, args: ['edit', outcome.before] })
  assert.equal(directoryFingerprint(top), before, 'rollback did not restore the tree')
  assert.equal(featureFilesOnDisk({ dir: top, tag: 't' }), 3)
  cli(['maintenance', 'disarm', '--token', token], repo)
})

test('migrating the tip first clears the blocker above the next workspace', () => {
  const { repo, top, mid, midHead } = foldedLine()
  writeFeatureFiles({ dir: mid, count: 3, tag: 'm' })
  const { token } = armedGate(repo)
  const env = { JJ_ISOLATION_MAINTENANCE_TOKEN: token }
  const midBefore = directoryFingerprint(mid)

  const blocked = cli(['migrate', 'mid', '--base', 'integration-spine', '--apply', '--accept-graft'], repo, env)
  assert.equal(blocked.status, 3)
  assert.equal(head(mid), midHead, 'a refused migration must not touch the workspace')

  assert.equal(cli(['migrate', 'top', '--base', 'integration-spine', '--apply', '--accept-graft'], repo, env).status, 0)
  const nowPlan = JSON.parse(cli(['migrate', 'mid', '--base', 'integration-spine'], repo, env).stdout).plan
  assert.deepEqual(nowPlan.blockers, [], 'the orphaned chain above mid must no longer block it')

  const applied = cli(['migrate', 'mid', '--base', 'integration-spine', '--apply'], repo, env)
  assert.equal(applied.status, 0, applied.stderr)
  assert.equal(directoryFingerprint(mid), midBefore)
  const heads = workspaceHeads(repo)
  assert.equal(Object.keys(heads).some(key => key.startsWith('mig-')), false, 'the scratch workspace must be gone')
  assert.notEqual(heads.mid, midHead)
  assert.equal(featureFilesOnDisk({ dir: mid, tag: 'm' }), 3)
  cli(['maintenance', 'disarm', '--token', token], repo)
})

test('a slot folded below the spine migrates with an empty leaf; a dirty one is blocked', () => {
  const repo = mkRepo()
  const root = dirname(repo)
  const spine = commitIdOf({ cwd: repo, revision: '@' })
  jjOk({ cwd: repo, args: ['bookmark', 'set', 'integration-spine', '-r', spine] })
  const parked = addWorkspace({ repo, root, name: 'parked', revision: spine })
  const parkedHead = commitIdOf({ cwd: parked, revision: '@' })
  // Fold the slot below the spine tip: the shape a consolidation leaves behind.
  jjOk({ cwd: repo, args: ['new', parkedHead, '-m', 'tip above parked'] })
  jjOk({ cwd: repo, args: ['bookmark', 'set', 'integration-spine', '-r', '@', '--allow-backwards'] })
  enableIsolation(repo)
  const { token } = armedGate(repo)
  const env = { JJ_ISOLATION_MAINTENANCE_TOKEN: token }

  const plan = JSON.parse(cli(['migrate', 'parked', '--base', 'integration-spine'], repo, env).stdout).plan
  assert.equal(plan.mode, 'reset-to-base')
  assert.deepEqual(plan.blockers, [])

  const applied = cli(['migrate', 'parked', '--base', 'integration-spine', '--apply'], repo, env)
  assert.equal(applied.status, 0, applied.stderr)
  assert.equal(JSON.parse(applied.stdout).applied.leafHasNoDescendants, true)

  // The same shape with unsnapshotted files: a snapshot would rewrite an
  // ancestor of the spine, so the plan must refuse.
  const parked2 = addWorkspace({ repo, root, name: 'parked2', revision: spine })
  const parked2Head = commitIdOf({ cwd: parked2, revision: '@' })
  jjOk({ cwd: repo, args: ['new', parked2Head, '-m', 'tip above parked2'] })
  jjOk({ cwd: repo, args: ['bookmark', 'set', 'integration-spine', '-r', '@', '--allow-backwards'] })
  const rearmed = armedGate(repo)
  writeFeatureFiles({ dir: parked2, count: 2, tag: 'p' })
  const dirtyPlan = JSON.parse(
    cli(['migrate', 'parked2', '--base', 'integration-spine'], repo, { JJ_ISOLATION_MAINTENANCE_TOKEN: rearmed.token }).stdout,
  ).plan
  assert.equal(dirtyPlan.mode, 'reset-to-base')
  assert.equal(
    dirtyPlan.blockers.some(blocker => blocker.includes('unsnapshotted')),
    true,
    `expected an unsnapshotted-changes blocker, got: ${JSON.stringify(dirtyPlan.blockers)}`,
  )
  assert.equal(featureFilesOnDisk({ dir: parked2, tag: 'p' }), 2)
  cli(['maintenance', 'disarm', '--token', rearmed.token, '--force'], repo)
})

test('the migrator issues its own preconditions rather than relying on the shim', () => {
  const { repo, mid } = foldedLine()
  const result = cli(['migrate', 'mid', '--base', 'integration-spine'], repo, { JJ_ISOLATION: 'off' })
  const plan = JSON.parse(result.stdout).plan
  assert.equal(plan.blockers.length > 0, true)
  assert.equal(plan.steps.length, 0)
  assert.equal(plan.foreignDescendantHeads.includes('top'), true)
})

test('enablement at the store covers every workspace, including added ones', () => {
  const { repo, mid } = foldedLine()
  const decision = guarded({ cwd: mid, args: ['describe', '-r', head(repo), '-m', 'x'] })
  assert.equal(decision.status, 3, `an added workspace must be fenced too, got: ${decision.stderr}`)
  assert.match(decision.stderr, /foreign-working-copy-rewrite|maintenance-active/)
  const read = guarded({ cwd: mid, args: ['log', '-r', '@', '--no-graph', '-T', 'commit_id', '--ignore-working-copy'] })
  assert.equal(read.status, 0, read.stderr)
})
