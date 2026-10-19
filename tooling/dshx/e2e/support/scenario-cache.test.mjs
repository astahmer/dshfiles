import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  readScenarioKeys,
  readScenarioReceipts,
  receiptIsFresh,
  recordScenarioPass,
  replayableScenarioIds,
  scenarioCacheFiles,
  scenarioIdOf,
  writeScenarioKeys,
} from './scenario-cache.mjs'

const key = (id, steps, digests) => ({ id, steps, digests })

test('scenarioIdOf reads the tag the harness titles its tests with', () => {
  assert.equal(scenarioIdOf('Persisted widths › Keep a width @scenario:frame-layout.panel-width-persistence'), 'frame-layout.panel-width-persistence')
  assert.equal(scenarioIdOf('a scenario without a tag'), undefined)
})

test('a receipt is fresh only for the same steps against the same built JavaScript', () => {
  const current = key('a.one', 'hash-1', { '@dshfiles/alpha': 'dist-1' })
  assert.equal(receiptIsFresh(current, undefined), false)
  assert.equal(receiptIsFresh(current, key('a.one', 'hash-1', { '@dshfiles/alpha': 'dist-1' })), true)
  assert.equal(receiptIsFresh(current, key('a.one', 'hash-2', { '@dshfiles/alpha': 'dist-1' })), false, 'changed steps')
  assert.equal(receiptIsFresh(current, key('a.one', 'hash-1', { '@dshfiles/alpha': 'dist-2' })), false, 'changed dist')
  assert.equal(receiptIsFresh(current, key('a.one', 'hash-1', {})), false, 'a bundle the scenario reaches was not proven')
  assert.equal(receiptIsFresh(current, key('a.one', 'hash-1', { '@dshfiles/alpha': 'dist-1', '@dshfiles/beta': 'dist-1' })), false, 'an extra bundle')
})

test('replayableScenarioIds selects per scenario, not per task', () => {
  const keys = { 'a.one': key('a.one', 'h1', { alpha: 'd1' }), 'a.two': key('a.two', 'h2', { beta: 'd1' }) }
  const receipts = { 'a.one': key('a.one', 'h1', { alpha: 'd1' }), 'a.two': key('a.two', 'h2', { beta: 'd2' }) }
  assert.deepEqual(replayableScenarioIds(keys, receipts), ['a.one'])
})

test('receipts round-trip through the store and keep the scenarios a run cannot replay out of it', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'dshx-scenario-cache-'))
  try {
    const files = scenarioCacheFiles(workspaceRoot)
    assert.ok(files.receipts.startsWith(workspaceRoot))
    await writeScenarioKeys(workspaceRoot, { 'a.one': key('a.one', 'h1', { alpha: 'd1' }) })
    assert.deepEqual(Object.keys(await readScenarioKeys(workspaceRoot)), ['a.one'])

    await recordScenarioPass({ workspaceRoot, key: key('a.one', 'h1', { alpha: 'd1' }), now: 1_700_000_000_000 })
    const receipts = await readScenarioReceipts(workspaceRoot)
    assert.equal(receipts['a.one']?.passedAt, new Date(1_700_000_000_000).toISOString())

    await recordScenarioPass({ workspaceRoot, key: key('a.two', 'h2', { beta: 'd1' }), now: 1_700_000_000_001 })
    assert.deepEqual(Object.keys(await readScenarioReceipts(workspaceRoot)).sort(), ['a.one', 'a.two'], 'a pass never drops another receipt')

    await writeFile(files.receipts, 'not json at all')
    assert.deepEqual(await readScenarioReceipts(workspaceRoot), {}, 'an unreadable store is a miss, never a false replay')
    assert.equal((await readFile(files.receipts, 'utf8')).length > 0, true)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})
