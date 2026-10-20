import { describe, expect, it } from 'vitest'
import { selectAnswerBoundary } from '../src/native/conversation-nodes/turn-process.ts'

const answers = (...steps: number[]) => steps.map(step => ({ step, text: `answer ${step}` }))

describe('selectAnswerBoundary', () => {
  it('uses the only answer', () => {
    expect(selectAnswerBoundary(answers(2))?.step).toBe(2)
  })

  it('keeps an answer when a later reply follows without work', () => {
    expect(selectAnswerBoundary(answers(2, 3))?.step).toBe(2)
  })

  it('keeps the first answer across several notice replies', () => {
    expect(selectAnswerBoundary(answers(2, 3, 4))?.step).toBe(2)
  })

  it('adopts a later answer after a tool call', () => {
    expect(selectAnswerBoundary(answers(2, 4), 3)?.step).toBe(4)
  })

  it('adopts the answer after work resumed twice', () => {
    expect(selectAnswerBoundary(answers(2, 4, 6), 5)?.step).toBe(6)
  })

  it('keeps a notice reply when work happened after it', () => {
    expect(selectAnswerBoundary(answers(2, 3), 4)?.step).toBe(3)
  })

  it('returns undefined without answers', () => {
    expect(selectAnswerBoundary([], 3)).toBeUndefined()
  })
})
