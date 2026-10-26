import { describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { UserQuestionProjectionView } from '@deepseek-ai/dsh-user-questions'
import { isAcceptedQuestionReply } from './native/authority.ts'

const settledCallId = ToolCallId('call_answered')
const settledQuestions = {
  active: [],
  settled: [{
    callId: settledCallId,
    answers: [{ id: 'resume', selected: ['Resume'] }],
  }],
} satisfies UserQuestionProjectionView

describe('continued user-question goal authority', () => {
  it('accepts only an answered reply matched to a settled call', () => {
    expect(isAcceptedQuestionReply({
      kind: 'user-question-reply',
      callId: settledCallId,
      outcome: 'answered',
    }, settledQuestions)).toBe(true)
  })

  it('rejects a reply without the answered outcome', () => {
    expect(isAcceptedQuestionReply({
      kind: 'user-question-reply',
      callId: settledCallId,
      outcome: 'skipped',
    }, settledQuestions)).toBe(false)
  })

  it('rejects an unmatched or stale call id', () => {
    expect(isAcceptedQuestionReply({
      kind: 'user-question-reply',
      callId: 'call_unknown',
      outcome: 'answered',
    }, settledQuestions)).toBe(false)
  })

  it('rejects a settled entry without a validated answer batch', () => {
    const emptyAnswerProjection = {
      active: [],
      settled: [{ callId: settledCallId, answers: [] }],
    } satisfies UserQuestionProjectionView

    expect(isAcceptedQuestionReply({
      kind: 'user-question-reply',
      callId: settledCallId,
      outcome: 'answered',
    }, emptyAnswerProjection)).toBe(false)
  })

  it('rejects missing projection state and malformed source data', () => {
    expect(isAcceptedQuestionReply({
      kind: 'user-question-reply',
      callId: settledCallId,
      outcome: 'answered',
    }, undefined)).toBe(false)
    expect(isAcceptedQuestionReply('answers: yes', settledQuestions)).toBe(false)
  })
})
