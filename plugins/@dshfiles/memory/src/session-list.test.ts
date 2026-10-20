import { describe, expect, it } from 'vitest'
import { MemorySessionList } from './session-list.ts'

const header = (id: string) => ({ id, createdAt: 1 })

describe('MemorySessionList', () => {
  it('lists Sessions once until one is created or disposed, or a minute passes', async () => {
    let lists = 0
    let now = 0
    const reads = new MemorySessionList({
      listSessions: async () => {
        lists += 1
        // SAFETY: the finder reads only these header fields.
        return [{ header: header(`s${lists}`) as never, live: false, persisted: true }]
      },
      now: () => now,
    })

    await reads.listSessions()
    await reads.listSessions()
    expect(lists).toBe(1)
    reads.sessionsChanged()
    await reads.listSessions()
    expect(lists).toBe(2)
    now = 60_001
    await reads.listSessions()
    expect(lists).toBe(3)
  })
})
