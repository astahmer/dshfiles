import { describe, expect, it } from 'vitest'

import { BacklogReference } from './backlog-reference.js'

const ids = (text: string): readonly number[] => BacklogReference.matches(text).map(match => match.id)

describe('backlog references', () => {
  it('finds an item id wherever prose, inline code or punctuation puts it', () => {
    expect(ids('Marked b:157 done, see (`b:159`) and "b:3".')).toEqual([157, 159, 3])
  })

  it('keeps text that merely contains the token from becoming a link', () => {
    expect(ids('rb:12 a/b:12 b:0 b:007')).toEqual([])
  })

  it('stops at the number, not at the word after it', () => {
    const [match] = BacklogReference.matches('b:12ties')
    expect(match).toBeUndefined()
    expect(ids('b:12,')).toEqual([12])
  })

  it('reports the exact span a link should cover', () => {
    const [match] = BacklogReference.matches('see b:42')
    expect(match).toEqual({ id: 42, start: 4, end: 8 })
  })

  it('ignores a number no item could have', () => {
    expect(ids('b:2147483648 b:999999999999999999999')).toEqual([])
  })
})
