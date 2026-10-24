import { describe, expect, it } from 'vitest'

import { replyTextAtSubmit } from './reply-input.js'

describe('reply text at submit', () => {
  it('uses the current textarea value instead of a stale controlled render', () => {
    expect(replyTextAtSubmit({ value: '@emi go fix the whole issue' }, '@emi go')).toBe('@emi go fix the whole issue')
  })

  it('falls back to controlled text when the textarea is unavailable', () => {
    expect(replyTextAtSubmit(null, 'the submitted reply')).toBe('the submitted reply')
  })
})
