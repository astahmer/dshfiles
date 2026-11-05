import { describe, expect, it } from 'vitest'
import { BacklogItems, type BacklogEvent } from './item.js'

const comment = (index: number): BacklogEvent => ({ at: index, actor: 'user', kind: 'commented', detail: `comment ${String(index)}` })

describe('appendEvent', () => {
  it('keeps the created event and the newest others once the history is full', () => {
    const created: BacklogEvent = { at: 0, actor: 'agent:session-abc123', kind: 'created', detail: 'chatty' }
    let events: BacklogEvent[] = [created]
    for (let index = 1; index <= 205; index++) events = BacklogItems.appendEvent(events, comment(index))

    expect(events).toHaveLength(200)
    expect(events[0]).toEqual(created)
    expect(events[1]?.detail).toBe('comment 7')
    expect(events.at(-1)?.detail).toBe('comment 205')
  })

  it('drops the oldest event of a history that no longer starts with its creation', () => {
    let events: BacklogEvent[] = []
    for (let index = 1; index <= 201; index++) events = BacklogItems.appendEvent(events, comment(index))

    expect(events).toHaveLength(200)
    expect(events[0]?.detail).toBe('comment 2')
  })
})
