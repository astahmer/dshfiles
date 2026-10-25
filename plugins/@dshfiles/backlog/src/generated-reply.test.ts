import { describe, expect, it } from 'vitest'

import { generatedReplyBody } from './generated-reply.js'

describe('generated reply body', () => {
  it.each(['@dsh', '**@dsh**'])('removes the repeated %s author label', prefix => {
    expect(generatedReplyBody({ answer: `${prefix}\n\nThe complete reply.`, handle: 'dsh' })).toBe('The complete reply.')
  })

  it('keeps an at-handle that is part of the reply text', () => {
    expect(generatedReplyBody({ answer: '@dshx is a different agent.', handle: 'dsh' })).toBe('@dshx is a different agent.')
  })

  it('keeps a different agent mention at the beginning', () => {
    expect(generatedReplyBody({ answer: '@emi can take this one.', handle: 'dsh' })).toBe('@emi can take this one.')
  })
})
