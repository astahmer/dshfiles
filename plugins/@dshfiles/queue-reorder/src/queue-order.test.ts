import { describe, expect, it } from 'vitest'
import type { InboxTarget } from '@deepseek-ai/dsh-agent/types'
import { describeInbox, moveWithinInbox, QueueItemMissingError, type QueueInbox } from './queue-order.js'

interface QueuedMessage {
  readonly id: string
}

interface RecordedSplice {
  readonly target: InboxTarget
  readonly start: number
  readonly deleteCount: number
  readonly inserted: readonly string[]
}

/** An in-memory inbox with standard splice semantics that records every splice it applies. */
const memoryInbox = (nextTurnIds: readonly string[], nextStepIds: readonly string[] = []) => {
  const lists: Record<InboxTarget, QueuedMessage[]> = {
    'next-turn': nextTurnIds.map(id => ({ id })),
    'next-step': nextStepIds.map(id => ({ id })),
  }
  const splices: RecordedSplice[] = []
  const inbox: QueueInbox<QueuedMessage> = {
    get nextTurn() {
      return lists['next-turn']
    },
    get nextStep() {
      return lists['next-step']
    },
    splice: (target, start, deleteCount, inserted) => {
      splices.push({ target, start, deleteCount, inserted: inserted.map(message => message.id) })
      return lists[target].splice(start, deleteCount, ...inserted)
    },
  }
  return { inbox, splices }
}

const ids = (messages: readonly QueuedMessage[]) => messages.map(message => message.id)

describe('moveWithinInbox', () => {
  it('moves an item one position as a remove plus an insert, keeping its identity', () => {
    const { inbox, splices } = memoryInbox(['a', 'b', 'c'])
    const position = moveWithinInbox(inbox, { sessionId: 's', itemId: 'c', direction: 'up' })
    expect(ids(inbox.nextTurn)).toEqual(['a', 'c', 'b'])
    expect(position).toEqual({ sessionId: 's', itemId: 'c', index: 1, total: 3, target: 'next-turn', first: false, last: false })
    expect(splices).toEqual([
      { target: 'next-turn', start: 2, deleteCount: 1, inserted: [] },
      { target: 'next-turn', start: 1, deleteCount: 0, inserted: ['c'] },
    ])
  })

  it('leaves an item at either end in place without splicing', () => {
    const { inbox, splices } = memoryInbox(['a', 'b'])
    expect(moveWithinInbox(inbox, { sessionId: 's', itemId: 'a', direction: 'up' })).toMatchObject({ index: 0, first: true })
    expect(moveWithinInbox(inbox, { sessionId: 's', itemId: 'b', direction: 'down' })).toMatchObject({ index: 1, last: true })
    expect(splices).toEqual([])
  })

  it('finds an item in the next-step list', () => {
    const { inbox } = memoryInbox(['a'], ['x', 'y'])
    expect(moveWithinInbox(inbox, { sessionId: 's', itemId: 'x', direction: 'down' })).toMatchObject({ target: 'next-step', index: 1 })
    expect(ids(inbox.nextStep)).toEqual(['y', 'x'])
  })

  it('reports an item that is no longer pending', () => {
    const { inbox } = memoryInbox(['a'])
    expect(() => moveWithinInbox(inbox, { sessionId: 's', itemId: 'gone', direction: 'up' })).toThrow(QueueItemMissingError)
  })
})

describe('describeInbox', () => {
  it('lists pending ids per list', () => {
    const { inbox } = memoryInbox(['a', 'b'], ['x'])
    expect(describeInbox(inbox)).toEqual([
      { target: 'next-turn', items: ['a', 'b'] },
      { target: 'next-step', items: ['x'] },
    ])
  })
})
