import { describe, expect, it, vi } from 'vitest'

vi.mock('@dshfiles/dshx/client', () => ({ useApiEvent: () => 'live' }))

const { InventoryPoll } = await import('./inventory-poll.js')

describe('host directory and thread list polling', () => {
  it('asks every 30 s without the change events, and only every five minutes while they are live', () => {
    expect(InventoryPoll.interval({ eventsLive: false, intervalMs: 30_000 })).toBe(30_000)
    expect(InventoryPoll.interval({ eventsLive: true, intervalMs: 30_000 })).toBe(300_000)
  })
})
