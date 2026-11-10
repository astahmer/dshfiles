import { describe, expect, it } from 'vitest'
import { applyFoldBatch, batchActive, batchCancelled, type FoldBatchEvent, type FoldBatchState } from '../src/native/chat/fold-batch.ts'

const idle: FoldBatchState = { kind: 'idle' }
const scheduled: FoldBatchState = { kind: 'scheduled', epoch: 3 }
const running: FoldBatchState = { kind: 'running', cancelled: false }
const settling: FoldBatchState = { kind: 'settling' }

const drive = (state: FoldBatchState, events: readonly FoldBatchEvent[]): FoldBatchState =>
  events.reduce((current, event) => applyFoldBatch(current, event).state, state)

describe('fold batch lifetime', () => {
  it('starts a batch only from its own scheduled commit, never twice', () => {
    expect(applyFoldBatch(idle, { kind: 'start', epoch: 3 })).toEqual({ state: idle, effects: [] })
    expect(applyFoldBatch(idle, { kind: 'schedule', epoch: 3 })).toEqual({ state: scheduled, effects: [] })
    expect(applyFoldBatch(scheduled, { kind: 'start', epoch: 2 })).toEqual({ state: scheduled, effects: [] })
    expect(applyFoldBatch(scheduled, { kind: 'start', epoch: 3 })).toEqual({ state: running, effects: ['begin'] })
    expect(applyFoldBatch(running, { kind: 'schedule', epoch: 4 })).toEqual({ state: running, effects: [] })
    expect(applyFoldBatch(running, { kind: 'start', epoch: 3 })).toEqual({ state: running, effects: [] })
    expect(batchActive(running)).toBe(true)
    expect(batchActive(settling)).toBe(false)
  })

  it('keeps cancellation inside the running batch', () => {
    expect(applyFoldBatch(idle, { kind: 'cancelInput' }).state).toEqual(idle)
    expect(applyFoldBatch(scheduled, { kind: 'cancelInput' }).state).toEqual(scheduled)
    expect(applyFoldBatch(settling, { kind: 'cancelInput' }).state).toEqual(settling)
    expect(batchCancelled(applyFoldBatch(running, { kind: 'cancelInput' }).state)).toBe(true)
    expect(batchCancelled(applyFoldBatch({ kind: 'running', cancelled: true }, { kind: 'cancelInput' }).state)).toBe(true)
    expect(batchCancelled(applyFoldBatch({ kind: 'running', cancelled: true }, { kind: 'resumeInput' }).state)).toBe(false)
    expect(applyFoldBatch(idle, { kind: 'resumeInput' }).state).toEqual(idle)
  })

  it('settles only the running batch and notifies idle only after the commit', () => {
    expect(applyFoldBatch(idle, { kind: 'settle' }).state).toEqual(idle)
    expect(applyFoldBatch(scheduled, { kind: 'settle' }).state).toEqual(scheduled)
    expect(applyFoldBatch(running, { kind: 'settle' })).toEqual({ state: settling, effects: ['commit'] })
    expect(applyFoldBatch(running, { kind: 'settled' }).state).toEqual(running)
    expect(applyFoldBatch(settling, { kind: 'settled' })).toEqual({ state: idle, effects: ['notifyIdle'] })
  })

  it('releases a scheduled commit without starting a batch, and drops the stale microtask', () => {
    expect(applyFoldBatch(scheduled, { kind: 'release' })).toEqual({ state: idle, effects: ['releaseHeld'] })
    expect(applyFoldBatch(running, { kind: 'release' }).state).toEqual(running)
    const cleared = drive(scheduled, [{ kind: 'clear' }])
    expect(cleared).toEqual(idle)
    expect(applyFoldBatch(cleared, { kind: 'start', epoch: 3 }).state).toEqual(idle)
    expect(applyFoldBatch(applyFoldBatch(cleared, { kind: 'schedule', epoch: 5 }).state, { kind: 'start', epoch: 3 }).state).toEqual({
      kind: 'scheduled',
      epoch: 5,
    })
  })

  it('clears every owned lifecycle exactly once', () => {
    expect(applyFoldBatch(idle, { kind: 'clear' })).toEqual({ state: idle, effects: [] })
    for (const state of [scheduled, running, settling]) {
      expect(applyFoldBatch(state, { kind: 'clear' })).toEqual({ state: idle, effects: ['clear'] })
      expect(applyFoldBatch(applyFoldBatch(state, { kind: 'clear' }).state, { kind: 'clear' })).toEqual({ state: idle, effects: [] })
    }
  })

  it('ignores a cancellation that would survive its batch', () => {
    const cancelled = drive(idle, [{ kind: 'schedule', epoch: 1 }, { kind: 'start', epoch: 1 }, { kind: 'cancelInput' }])
    expect(batchCancelled(cancelled)).toBe(true)
    const next = drive(cancelled, [{ kind: 'settle' }, { kind: 'settled' }, { kind: 'schedule', epoch: 2 }, { kind: 'start', epoch: 2 }])
    expect(batchCancelled(next)).toBe(false)
  })
})
