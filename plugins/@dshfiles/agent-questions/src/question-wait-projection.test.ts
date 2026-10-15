import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-questions'
import { describe, expect, it } from 'vitest'
import { applyQuestionWaitEvent, defaultTimeoutFromDescription, type QuestionWaitState } from './question-wait-projection.js'

const callId = ToolCallId('call-1')
const questionArguments = [{ id: 'decision', question: 'Which approach should I take?' }]

const timedHeaderEvent = {
  type: 'request/header',
  seq: SessionSeq(0),
  time: 1_000,
  data: {
    reason: 'initial',
    header: {
      config: { provider: 'test', model: 'test' },
      tools: [
        {
          name: 'ask_user_question',
          description: 'Ask the user.',
          parameters: {
            type: 'object',
            properties: {
              questions: { type: 'array' },
              timeout: { type: 'integer', description: 'Wait seconds for the batch (default 120).' },
            },
          },
        },
      ],
    },
  },
} satisfies SessionEvent

const toolCallEvent = (input: { readonly seq: number; readonly time: number; readonly timeout?: number }) => {
  const argumentsValue = input.timeout === undefined ? { questions: questionArguments } : { questions: questionArguments, timeout: input.timeout }

  return {
    type: 'tool/call',
    seq: SessionSeq(input.seq),
    time: input.time,
    data: {
      turn: 1,
      step: 1,
      callId,
      name: 'ask_user_question',
      arguments: JSON.stringify(argumentsValue),
    },
  } satisfies SessionEvent
}

const pendingResultEvent = {
  type: 'tool/result',
  seq: SessionSeq(2),
  time: 2_000,
  data: {
    turn: 1,
    step: 1,
    message: {
      id: MessageId('result-1'),
      role: 'tool',
      source: { kind: 'tool', callId },
      toolCallId: callId,
      content: [{ type: 'text', text: '{"pending":true,"callId":"call-1"}' }],
    },
  },
  surfaceOp: 'append',
} satisfies SessionEvent

const userReplyEvent = {
  type: 'user/message',
  seq: SessionSeq(3),
  time: 3_000,
  data: {
    id: MessageId('reply-1'),
    role: 'user',
    source: { kind: 'user-question-reply', callId, outcome: 'answered' },
    content: [{ type: 'text', text: '{"answers":[]}' }],
  },
  surfaceOp: 'append',
} satisfies SessionEvent

const emptyState: QuestionWaitState = {
  timedToolConfigured: false,
  defaultTimeoutSeconds: null,
  active: [],
}

describe('question wait projection', () => {
  it('derives the default from the recorded timed tool schema', () => {
    expect(defaultTimeoutFromDescription('Wait seconds for the batch (default 120).')).toBe(120)
    expect(defaultTimeoutFromDescription('No default is declared.')).toBeNull()
  })

  it('records a timed deadline, continues after a pending result, then settles on reply', () => {
    const configured = applyQuestionWaitEvent(emptyState, timedHeaderEvent)
    const open = applyQuestionWaitEvent(configured, toolCallEvent({ seq: 1, time: 1_200, timeout: 10 }))

    expect(open.active).toMatchObject([
      {
        callId,
        waitMode: 'timed',
        startedAt: 1_200,
        timeoutMs: 10_000,
        deadlineAt: 11_200,
      },
    ])

    const continued = applyQuestionWaitEvent(open, pendingResultEvent)
    expect(continued.active).toEqual(open.active)
    expect(applyQuestionWaitEvent(continued, userReplyEvent).active).toEqual([])
  })

  it('uses the recorded default and represents timeout -1 as blocking', () => {
    const configured = applyQuestionWaitEvent(emptyState, timedHeaderEvent)
    const defaulted = applyQuestionWaitEvent(configured, toolCallEvent({ seq: 1, time: 1_200 }))
    expect(defaulted.active[0]).toMatchObject({ waitMode: 'timed', timeoutMs: 120_000, deadlineAt: 121_200 })

    const blocking = applyQuestionWaitEvent(configured, toolCallEvent({ seq: 2, time: 2_000, timeout: -1 }))
    expect(blocking.active[0]).toMatchObject({ waitMode: 'blocking', timeoutMs: null, deadlineAt: null })
  })
})
