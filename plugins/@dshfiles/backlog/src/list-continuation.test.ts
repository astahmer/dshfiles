import { describe, expect, it } from 'vitest'

import { continueMarkdownList } from './list-continuation.js'

describe('continueMarkdownList', () => {
  it('continues unordered list markers at the caret', () => {
    expect(continueMarkdownList({ text: 'notes\n  * item', start: 14, end: 14 })).toEqual({
      value: 'notes\n  * item\n  * ',
      caret: 19,
    })
  })

  it('increments ordered list numbers', () => {
    expect(continueMarkdownList({ text: '8. item', start: 7, end: 7 })).toEqual({
      value: '8. item\n9. ',
      caret: 11,
    })
  })

  it('removes an empty list marker instead of continuing an empty item', () => {
    expect(continueMarkdownList({ text: 'before\n- ', start: 9, end: 9 })).toEqual({ value: 'before\n', caret: 7 })
  })

  it('continues from the caret and preserves text after it', () => {
    expect(continueMarkdownList({ text: '- first item', start: 9, end: 9 })).toEqual({
      value: '- first i\n- tem',
      caret: 12,
    })
  })

  it('does not transform a non-list line', () => {
    expect(continueMarkdownList({ text: 'just text', start: 9, end: 9 })).toBeNull()
  })
})
