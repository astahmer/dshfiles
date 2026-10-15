import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { ParentQuestionInboxEntry } from './service.js'
import type { QuestionWaitRecord } from './question-wait-projection.js'
import { projectNativeQuestion, projectParentQuestion } from './question-inbox.js'
import { describe, expect, it } from 'vitest'

const parentQuestion = (input: { readonly expired: boolean }): ParentQuestionInboxEntry => ({
  questionId: 'question-1',
  childSessionId: 'child-session',
  question: 'Which migration strategy should I use?',
  context: 'The migration preserves existing records.',
  options: [
    { id: 'expand', label: 'Expand and contract' },
    { id: 'replace', label: 'Replace directly' },
  ],
  recommendedOptionId: 'expand',
  expiryBehavior: 'recommended',
  createdAt: 1_000,
  expiresAt: 11_000,
  remainingMs: input.expired ? 0 : 3_000,
  expired: input.expired,
})

describe('question inbox projections', () => {
  it('marks native recommended options and exposes current wait metadata without claiming the UI', () => {
    const nativeCallId = ToolCallId('native-call')
    const wait: QuestionWaitRecord = {
      callId: nativeCallId,
      waitMode: 'timed',
      startedAt: 1_000,
      timeoutMs: 10_000,
      deadlineAt: 11_000,
    }
    const projected = projectNativeQuestion({
      sessionId: 'root-session',
      sessionLive: true,
      sessionPersisted: true,
      targetIsLiveRoot: true,
      pending: {
        callId: nativeCallId,
        state: 'open',
        questions: [
          {
            id: 'decision',
            question: 'Which approach should I take?',
            options: [{ label: 'Keep the current behavior (Recommended)', description: 'Lowest risk.' }, { label: 'Change the behavior' }],
          },
        ],
      },
      wait,
      observedAt: 4_000,
    })

    expect(projected).toMatchObject({
      kind: 'native',
      state: 'open',
      waitMode: 'timed',
      blocking: true,
      deadlineAt: 11_000,
      remainingMs: 7_000,
      countdownBasis: 'event-derived-estimate',
      canAnswer: false,
      answerability: 'open-form-uses-native-waterfall',
      questions: [
        {
          id: 'decision',
          options: [
            { label: 'Keep the current behavior (Recommended)', recommended: true },
            { label: 'Change the behavior', recommended: false },
          ],
        },
      ],
    })
  })

  it('marks continued native forms answerable only for live root Sessions', () => {
    const pending: Parameters<typeof projectNativeQuestion>[0]['pending'] = {
      callId: ToolCallId('native-call'),
      state: 'continued',
      questions: [{ id: 'decision', question: 'Continue?' }],
    }
    const projected = projectNativeQuestion({
      sessionId: 'root-session',
      sessionLive: true,
      sessionPersisted: true,
      targetIsLiveRoot: true,
      pending,
      observedAt: 5_000,
    })
    const stopped = projectNativeQuestion({
      sessionId: 'root-session',
      sessionLive: false,
      sessionPersisted: true,
      targetIsLiveRoot: true,
      pending,
      observedAt: 5_000,
    })
    const stoppedOpen = projectNativeQuestion({
      sessionId: 'stopped-session',
      sessionLive: false,
      sessionPersisted: true,
      targetIsLiveRoot: false,
      pending: { callId: ToolCallId('open-call'), state: 'open', questions: [{ id: 'decision', question: 'Continue?' }] },
      observedAt: 5_000,
    })

    expect(projected).toMatchObject({
      state: 'continued',
      blocking: false,
      remainingMs: null,
      canAnswer: true,
      answerability: 'continued-form-can-be-answered',
    })
    expect(stopped).toMatchObject({
      state: 'continued',
      canAnswer: false,
      answerability: 'session-not-live',
    })
    expect(stoppedOpen).toMatchObject({
      state: 'open',
      canAnswer: false,
      answerability: 'session-not-live',
    })
  })

  it('marks the recommended child option and prevents answering expired requests', () => {
    const pending = projectParentQuestion(parentQuestion({ expired: false }))
    const expired = projectParentQuestion(parentQuestion({ expired: true }))

    expect(pending).toMatchObject({
      kind: 'child',
      blocksParent: false,
      blocksChild: true,
      canAnswer: true,
      options: [
        { id: 'expand', recommended: true },
        { id: 'replace', recommended: false },
      ],
    })
    expect(expired.canAnswer).toBe(false)
  })
})
