import { describe, expect, it } from 'vitest'
import { replyAnswerValues, replyPairsOf, type QuestionReplyData } from '../src/native/question-reply.js'

const reply = (text: string): QuestionReplyData => ({
  callId: 'synthetic-call',
  outcome: 'answered',
  text,
  time: 1,
  ...replyPairsOf(text),
})

describe('native continued-question reply presentation', () => {
  it('preserves selected labels and a trimmed custom answer in display order', () => {
    const data = reply(
      JSON.stringify({
        questions: [{ id: 'layout', question: 'Choose a layout', options: [{ label: 'Grouped' }, { label: 'Flat' }] }],
        answers: [{ id: 'layout', selected: ['Grouped'], custom: '  Keep dates visible  ' }],
      }),
    )
    expect(data.questions).toHaveLength(1)
    expect(replyAnswerValues(data, 'layout')).toEqual(['Grouped', 'Keep dates visible'])
  })

  it('retains an explicitly skipped question without inventing an answer', () => {
    const data = reply(JSON.stringify({ questions: [{ id: 'layout', question: 'Choose a layout' }], answers: [{ id: 'layout', selected: [] }] }))
    expect(data.questions).toHaveLength(1)
    expect(replyAnswerValues(data, 'layout')).toEqual([])
    expect(replyAnswerValues(data, 'missing')).toEqual([])
  })

  it('falls back to raw text for unreadable payloads and filters malformed entries', () => {
    expect(replyPairsOf('not JSON')).toEqual({ questions: [], answers: [] })
    expect(
      replyPairsOf(
        JSON.stringify({ questions: [null, { id: 1 }, { id: 'valid', question: 'Question' }], answers: [null, { id: 'valid', selected: ['Yes', 1] }] }),
      ),
    ).toEqual({
      questions: [{ id: 'valid', question: 'Question' }],
      answers: [{ id: 'valid', selected: ['Yes'] }],
    })
  })
})
