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
    expect(selectAnswerBoundary(answers(2, 4), [3])?.step).toBe(4)
  })

  it('adopts the answer after work resumed twice', () => {
    expect(selectAnswerBoundary(answers(2, 4, 6), [3, 5])?.step).toBe(6)
  })

  it('adopts only the answer a tool call introduced', () => {
    expect(selectAnswerBoundary(answers(2, 4, 6, 8), [3])?.step).toBe(4)
  })

  it('keeps the earlier answer when work resumes after the last reply', () => {
    expect(selectAnswerBoundary(answers(2, 3), [4])?.step).toBe(2)
  })

  it('keeps the answer while a later tool call runs', () => {
    expect(selectAnswerBoundary(answers(2, 3), [4, 5])?.step).toBe(2)
  })

  it('returns undefined without answers', () => {
    expect(selectAnswerBoundary([], [3])).toBeUndefined()
  })
})
