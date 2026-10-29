import { describe, expect, it } from 'vitest'
import { replyAnswerValues, replyPairsOf, type QuestionReplyData } from '../src/native/question-reply.js'

const reply = ({ answers = [], text = '' }: { readonly answers?: QuestionReplyData['answers']; readonly text?: string }): QuestionReplyData => ({
  callId: 'call-1',
  outcome: 'answered',
  questions: [],
  answers,
  text,
  time: 0,
})

describe('replyPairsOf', () => {
  it('reads the question and answer pairs out of the reply payload', () => {
    const pairs = replyPairsOf(
      JSON.stringify({
        questions: [{ id: 'q1', question: 'Which one?', options: [{ label: 'A', description: 'first' }], multiSelect: true }],
        answers: [{ id: 'q1', selected: ['A'], custom: 'neither' }],
      }),
    )
    expect(pairs.questions).toEqual([{ id: 'q1', question: 'Which one?', options: [{ label: 'A', description: 'first' }], multiSelect: true }])
    expect(pairs.answers).toEqual([{ id: 'q1', selected: ['A'], custom: 'neither' }])
  })

  it('keeps only string selections of an answer', () => {
    const pairs = replyPairsOf(JSON.stringify({ questions: [], answers: [{ id: 'q1', selected: ['A', 3, null] }] }))
    expect(pairs.answers).toEqual([{ id: 'q1', selected: ['A'] }])
  })

  it('drops a question or answer that has no string id', () => {
    const pairs = replyPairsOf(JSON.stringify({ questions: [{ question: 'orphan' }], answers: [{ selected: ['A'] }] }))
    expect(pairs).toEqual({ questions: [], answers: [] })
  })

  it('returns no pairs when the reply text is not JSON', () => {
    expect(replyPairsOf('the model-facing text')).toEqual({ questions: [], answers: [] })
  })
})

describe('replyAnswerValues', () => {
  it('lists the selected labels then a trimmed custom answer', () => {
    expect(replyAnswerValues(reply({ answers: [{ id: 'q1', selected: ['A', 'B'], custom: '  neither  ' }] }), 'q1')).toEqual(['A', 'B', 'neither'])
  })

  it('leaves a skipped question empty', () => {
    expect(replyAnswerValues(reply({}), 'q1')).toEqual([])
  })

  it('omits a blank custom answer', () => {
    expect(replyAnswerValues(reply({ answers: [{ id: 'q1', selected: [], custom: '   ' }] }), 'q1')).toEqual([])
  })
})
