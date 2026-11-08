import type { ConversationTimelineSnapshot, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import type { ChatNode } from '../src/native/contract/chat-nodes.ts'
import type { ChatSnapshot } from '../src/native/contract/snapshot.ts'
import { ChatSnapshotBuilder, orderedVisibleChatNodes } from '../src/native/conversation-nodes/chat-snapshot-builder.ts'
import { turnNavigationItem } from '../src/native/conversation-nodes/turn-navigation.ts'

const turnLocation = (turn: number, seq: number, status: TurnLocation['status']): TurnLocation => ({
  turn,
  start: { type: 'turn/start', seq: SessionSeq(seq), time: 1, data: { turn } },
  end: undefined,
  status,
  steps: [],
  data: {
    get: () => undefined,
    source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
  },
})

const assistantNode = (input: {
  readonly turn: number
  readonly seq: number
  readonly text: string
  readonly status: 'running' | 'settled'
  readonly turnSeq: number
}): ChatNode<'assistant-step'> => ({
  key: `assistant:${input.turn}`,
  kind: 'assistant-step',
  id: String(input.turn),
  target: 'chat',
  anchorSeq: input.seq,
  location: { kind: 'turn', turn: turnLocation(input.turn, input.turnSeq, input.status === 'running' ? 'open' : 'closed') },
  visibility: 'visible',
  data: {
    status: input.status,
    turn: input.turn,
    step: 0,
    blocks: [{ kind: 'text', text: input.text }],
    time: 1,
  },
})

const tailNode = (input: {
  readonly turn: number
  readonly seq: number
  readonly turnSeq: number
  readonly status: TurnLocation['status']
}): ChatNode<'turn-tail'> => ({
  key: `turn-tail:${input.turn}`,
  kind: 'turn-tail',
  id: String(input.turn),
  target: 'chat',
  anchorSeq: input.seq + 0.1,
  location: { kind: 'turn', turn: turnLocation(input.turn, input.turnSeq, input.status) },
  visibility: 'visible',
  groupTree: 'turn',
  data: {
    turn: input.turn,
    seq: input.seq,
    time: 1,
    closing: null,
    branchUnavailable: true,
  },
})

/** Every turn's rail item, derived from the snapshot alone the way a rebuild would. */
const railItems = (timeline: ConversationTimelineSnapshot, snapshot: ChatSnapshot) =>
  timeline.turnOrder.map(turn => turnNavigationItem(turn, snapshot.locations, snapshot.nodes)).filter(item => item !== undefined)

describe('ChatSnapshotBuilder', () => {
  it('keeps the visible order and Turn rail a full recomputation would produce while a Turn streams', () => {
    const closingTurn = turnLocation(1, 10, 'closed')
    const openTurn = turnLocation(2, 30, 'open')
    const timeline: ConversationTimelineSnapshot = {
      turnOrder: [1, 2],
      turns: new Map([
        [1, closingTurn],
        [2, openTurn],
      ]),
    }
    const builder = new ChatSnapshotBuilder()
    let snapshot = builder.replace({
      nodes: [
        assistantNode({ turn: 1, seq: 11, text: 'answered', status: 'settled', turnSeq: 10 }),
        tailNode({ turn: 1, seq: 20, turnSeq: 10, status: 'closed' }),
        assistantNode({ turn: 2, seq: 31, text: '', status: 'running', turnSeq: 30 }),
        tailNode({ turn: 2, seq: 31, turnSeq: 30, status: 'open' }),
      ],
      timeline,
    })
    const firstOrder = snapshot.order
    for (let chunk = 1; chunk <= 6; chunk += 1) {
      const seq = 31 + chunk * 0.001
      snapshot = builder.apply({
        upserts: [
          assistantNode({ turn: 2, seq: 31, text: 'word '.repeat(chunk), status: 'running', turnSeq: 30 }),
          tailNode({ turn: 2, seq, turnSeq: 30, status: 'open' }),
        ],
        timeline,
      })
      builder.publish()
      expect(snapshot.order).toBe(firstOrder)
      expect(snapshot.order).toEqual(orderedVisibleChatNodes(snapshot.nodes.values()).map(node => node.key))
      expect(snapshot.order.at(-1)).toBe('turn-tail:2')
      expect(snapshot.navigation.items()).toEqual(railItems(timeline, snapshot))
    }
  })
})
