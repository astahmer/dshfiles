import { createActor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it, vi } from 'vitest'
import { autoSettleMachine, type AutoSettleClient } from './auto-settle-machine.js'

const startFlow = (client: AutoSettleClient, intervalMs = 250) => {
  const actor = createActor(autoSettleMachine, { input: { client, intervalMs, refreshKey: 'initial' } }).start()
  return actor
}

describe('auto-settle machine', () => {
  it('scans immediately when enabled and on its actor-owned interval', async () => {
    vi.useFakeTimers()
    const scan = vi.fn()
    const actor = startFlow({ scan })
    try {
      actor.send({ type: 'configure', enabled: true, intervalMs: 250, refreshKey: 'initial' })
      expect(scan).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(250)

      expect(scan).toHaveBeenCalledTimes(2)
    } finally {
      actor.stop()
      vi.useRealTimers()
    }
  })

  it('stops the interval when auto-settle is disabled', async () => {
    vi.useFakeTimers()
    const scan = vi.fn()
    const actor = startFlow({ scan })
    try {
      actor.send({ type: 'configure', enabled: true, intervalMs: 250, refreshKey: 'initial' })
      actor.send({ type: 'configure', enabled: false, intervalMs: 250, refreshKey: 'initial' })
      await vi.advanceTimersByTimeAsync(1_000)

      expect(scan).toHaveBeenCalledTimes(1)
    } finally {
      actor.stop()
      vi.useRealTimers()
    }
  })

  it('rescans immediately when policy inputs change and resets the interval', async () => {
    vi.useFakeTimers()
    const scan = vi.fn()
    const actor = startFlow({ scan })
    try {
      actor.send({ type: 'configure', enabled: true, intervalMs: 250, refreshKey: 'initial' })
      actor.send({ type: 'configure', enabled: true, intervalMs: 500, refreshKey: 'updated' })
      expect(scan).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(250)
      expect(scan).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(250)
      expect(scan).toHaveBeenCalledTimes(3)
    } finally {
      actor.stop()
      vi.useRealTimers()
    }
  })

  it('cancels scheduled scans when the actor stops', async () => {
    vi.useFakeTimers()
    const scan = vi.fn()
    const actor = startFlow({ scan })
    try {
      actor.send({ type: 'configure', enabled: true, intervalMs: 250, refreshKey: 'initial' })
      actor.stop()
      await vi.advanceTimersByTimeAsync(1_000)

      expect(scan).toHaveBeenCalledTimes(1)
    } finally {
      actor.stop()
      vi.useRealTimers()
    }
  })
})
