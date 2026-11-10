import { describe, expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { ConversationLocation, ConversationMatch, ConversationStartMatch, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { LlmAttemptId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { assistantDefinition } from '../src/native/conversation-nodes/assistant.ts'

type UpdateContext = Parameters<typeof assistantDefinition.update>[0]

const data = { get: () => undefined, source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) }
const turn: TurnLocation = { turn: 1, start: undefined, end: undefined, status: 'open', steps: [], data }
const step: ConversationLocation = { kind: 'step', turn, step: { turn: 1, step: 1, start: undefined, end: undefined, status: 'open', data } }
const noPredecessors = { previous: () => undefined }
const start: ConversationStartMatch = {
  role: 'start',
  location: step,
  event: { type: 'step/start', seq: SessionSeq(10), time: 1000, data: { turn: 1, step: 1 } },
}

const stream = (chunks: readonly StreamChunk[]) => {
  const base = { key: 'assistant-step:1:1', kind: 'assistant-step', id: '1:1', start, matches: [start], current: new Map() }
  const unstarted = {
    ...base,
    get state(): never {
      throw new Error('start reads no state')
    },
  }
  let context: UpdateContext = { ...base, state: assistantDefinition.start(unstarted, start, noPredecessors) }
  return chunks.map((chunk, index) => {
    const match: ConversationMatch = {
      role: 'update',
      location: step,
      event: {
        type: 'assistant/live-chunk',
        seq: SessionSeq(11 + index),
        time: 1001 + index,
        data: { attemptId: LlmAttemptId('attempt-1'), turn: 1, step: 1, chunk },
      },
    }
    context = { ...context, state: assistantDefinition.update(context, match) }
    return { visibleBlocks: context.state.visibleBlocks, firstVisibleSeq: context.state.firstVisibleSeq }
  })
}

describe('assistant visibility while streaming', () => {
  it('stays hidden through whitespace deltas and becomes visible at the first non-space delta', () => {
    expect(
      stream([
        { type: 'text-delta', index: 0, text: '  ' },
        { type: 'text-delta', index: 0, text: '\n\t' },
        { type: 'text-delta', index: 0, text: 'Hi' },
        { type: 'text-delta', index: 0, text: ' ' },
      ]),
    ).toEqual([
      { visibleBlocks: 0, firstVisibleSeq: undefined },
      { visibleBlocks: 0, firstVisibleSeq: undefined },
      { visibleBlocks: 1, firstVisibleSeq: 13 },
      { visibleBlocks: 1, firstVisibleSeq: 13 },
    ])
  })

  it('counts reasoning and text blocks independently', () => {
    expect(
      stream([
        { type: 'reasoning-delta', index: 0, text: 'think' },
        { type: 'text-delta', index: 1, text: ' ' },
        { type: 'text-delta', index: 1, text: 'answer' },
      ]).map(state => state.visibleBlocks),
    ).toEqual([1, 1, 2])
  })
})
