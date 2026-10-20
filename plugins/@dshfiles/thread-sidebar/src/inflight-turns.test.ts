import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { InflightTurns } from './inflight-turns.js'
import { createRestartRecoveryStore } from './restart-recovery.js'

test('turn boundaries are the only events that open or close an in-flight turn', () => {
  assert.equal(InflightTurns.boundaryFromEvent({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } }), 'start')
  assert.equal(InflightTurns.boundaryFromEvent({ type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'completed' } } }), 'end')
  assert.equal(InflightTurns.boundaryFromEvent({ type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'interrupted' } } }), 'interrupted')
  assert.equal(InflightTurns.boundaryFromEvent({ type: 'step/start', seq: 3, time: 3, data: { turn: 1, step: 1 } }), null)
  assert.equal(InflightTurns.boundaryFromEvent(null), null)
})

test('a turn left in flight by an ungraceful exit is promoted as interrupted, once', async () => {
  const home = await mkdtemp(join(tmpdir(), 'thread-sidebar-recovery-'))
  try {
    const inflight = InflightTurns.open({ home, now: () => 500 })
    await inflight.start('crashed-mid-turn')
    await inflight.start('finished-cleanly')
    await inflight.end('finished-cleanly')
    assert.deepEqual(await inflight.list(), [{ sessionId: 'crashed-mid-turn', startedAt: 500 }])

    const recovery = createRestartRecoveryStore({ home, now: () => 900 })
    assert.deepEqual(await InflightTurns.promote({ inflight, recovery }), ['crashed-mid-turn'])

    const entries = await createRestartRecoveryStore({ home }).list()
    assert.deepEqual(
      entries.map(entry => [entry.sessionId, entry.reason]),
      [['crashed-mid-turn', 'interrupted']],
    )
    // The in-flight file is empty, so a second boot promotes nothing.
    assert.deepEqual(await InflightTurns.promote({ inflight, recovery }), [])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a managed restart keeps its own reason when the same thread was also in flight', async () => {
  const home = await mkdtemp(join(tmpdir(), 'thread-sidebar-recovery-'))
  try {
    const recovery = createRestartRecoveryStore({ home })
    await recovery.record(['both'], 'restart')
    const inflight = InflightTurns.open({ home })
    await inflight.start('both')
    await inflight.start('crash-only')
    await InflightTurns.promote({ inflight, recovery })
    const reasons = new Map((await recovery.list()).map(entry => [entry.sessionId, entry.reason]))
    assert.equal(reasons.get('both'), 'restart')
    assert.equal(reasons.get('crash-only'), 'interrupted')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
