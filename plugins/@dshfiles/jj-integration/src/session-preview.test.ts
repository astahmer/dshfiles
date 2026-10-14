import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { describe, expect, it } from 'vitest'
import { sessionPreviewMessages } from './session-preview.js'

const userEvent = (seq: number, text: string, source: 'user' | 'system-prompt' = 'user'): SessionEvent<'user/message'> => ({
  type: 'user/message',
  seq: SessionSeq(seq),
  time: seq,
  data: {
    id: MessageId(`user-${seq}`),
    role: 'user',
    source: source === 'user' ? { kind: 'user' } : { kind: 'system-prompt' },
    content: [{ type: 'text', text }],
  },
  surfaceOp: 'append',
})

const assistantEvent = (seq: number, text: string): SessionEvent<'assistant/message'> => ({
  type: 'assistant/message',
  seq: SessionSeq(seq),
  time: seq,
  data: {
    turn: seq,
    step: 0,
    message: {
      id: MessageId(`assistant-${seq}`),
      role: 'assistant',
      source: { kind: 'model', provider: 'test', model: 'test' },
      content: [{ type: 'text', text }],
    },
    stream: [],
  },
  surfaceOp: 'append',
})

const entry = (event: SessionEvent<'user/message'> | SessionEvent<'assistant/message'>): SessionEventLikeEntry => ({ type: 'event', event })

describe('sessionPreviewMessages', () => {
  it('returns only the three latest direct user and assistant messages in order', () => {
    expect(
      sessionPreviewMessages([
        entry(userEvent(1, 'first prompt')),
        entry(assistantEvent(2, 'first answer')),
        entry(userEvent(3, 'latest prompt')),
        entry(assistantEvent(4, 'latest answer')),
        entry(userEvent(5, 'follow-up')),
      ]),
    ).toEqual([
      { seq: 3, role: 'user', text: 'latest prompt' },
      { seq: 4, role: 'assistant', text: 'latest answer' },
      { seq: 5, role: 'user', text: 'follow-up' },
    ])
  })

  it('omits injected user content and clips long text on a Unicode boundary', () => {
    const longText = `${'a'.repeat(359)}😀z`
    const [message] = sessionPreviewMessages([entry(userEvent(1, 'internal prompt', 'system-prompt')), entry(assistantEvent(2, longText))])

    expect(message).toEqual({ seq: 2, role: 'assistant', text: `${'a'.repeat(359)}😀…` })
  })
})
