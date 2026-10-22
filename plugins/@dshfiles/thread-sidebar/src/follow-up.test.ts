import { describe, expect, it } from 'vitest'
import { followUpPrompt } from './follow-up.js'

describe('followUpPrompt', () => {
  it('prefills a follow-up prefix with the source thread mention', () => {
    expect(followUpPrompt('session-example')).toBe('Follow-up after @session:session-example :\n')
  })

  it('rejects an empty source thread ID', () => {
    expect(() => followUpPrompt('')).toThrow('A follow-up requires a valid thread ID.')
  })
})
