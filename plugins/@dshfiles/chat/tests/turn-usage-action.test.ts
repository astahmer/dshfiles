import { describe, expect, it } from 'vitest'
import { showsTurnUsage } from '../src/native/chat/turn-usage-action.ts'

describe('the usage entry among the reply actions', () => {
  it('is not offered for a turn that used no tokens', () => {
    expect(showsTurnUsage({ totalTokens: 0 })).toBe(false)
    expect(showsTurnUsage(undefined)).toBe(false)
  })

  it('is offered once the turn used tokens', () => {
    expect(showsTurnUsage({ totalTokens: 1_250 })).toBe(true)
  })
})
