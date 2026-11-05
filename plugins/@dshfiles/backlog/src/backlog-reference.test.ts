import { describe, expect, it } from 'vitest'

import { BacklogReference } from './backlog-reference.js'

const refs = (text: string): readonly string[] => BacklogReference.matches(text).map(match => match.ref)

describe('backlog references', () => {
  it('finds a legacy number wherever prose, inline code or punctuation puts it', () => {
    expect(refs('Marked b:157 done, see (`b:159`) and "b:3".')).toEqual(['157', '159', '3'])
  })

  it('finds short aliases of four and five characters next to legacy numbers', () => {
    expect(refs('b:k3f9 and b:12, then b:7hq2x.')).toEqual(['k3f9', '12', '7hq2x'])
  })

  it('reads an uppercase alias as its lowercase ref', () => {
    expect(refs('see b:K3F9')).toEqual(['k3f9'])
  })

  it('keeps text that merely contains the token from becoming a link', () => {
    expect(refs('rb:12 a/b:12 b:0 b:007 web:k3f9 x/b:k3f9')).toEqual([])
  })

  it('stops at the token, not at the word after it', () => {
    expect(refs('b:12ties b:k3f9abc')).toEqual([])
    expect(refs('b:12, b:k3f9;')).toEqual(['12', 'k3f9'])
  })

  it('rejects shapes no alias can have', () => {
    expect(refs('b:abc b:abcdef b:todo b:1234x5')).toEqual([])
    expect(refs('b:0000 b:12345')).toEqual(['12345'])
  })

  it('reports the exact span a link should cover', () => {
    expect(BacklogReference.matches('see b:42')).toEqual([{ ref: '42', start: 4, end: 8 }])
    expect(BacklogReference.matches('see b:k3f9')).toEqual([{ ref: 'k3f9', start: 4, end: 10 }])
  })

  it('ignores a number no item could have', () => {
    expect(refs('b:2147483648 b:999999999999')).toEqual([])
  })

  it('parses a tool input with or without its prefix', () => {
    expect(BacklogReference.parse('b:k3f9')).toBe('k3f9')
    expect(BacklogReference.parse('K3F9')).toBe('k3f9')
    expect(BacklogReference.parse('12')).toBe('12')
    expect(BacklogReference.parse('b:12')).toBe('12')
    expect(BacklogReference.parse('b:')).toBeUndefined()
    expect(BacklogReference.parse('k3f')).toBeUndefined()
  })

  it('names an item by its short alias, else its legacy number', () => {
    expect(BacklogReference.labelOf({ id: 12 })).toBe('b:12')
    expect(BacklogReference.labelOf({ id: 600, ref: 'k3f9' })).toBe('b:k3f9')
    expect(BacklogReference.requestId('12')).toBe(12)
    expect(BacklogReference.requestId('k3f9')).toBe('k3f9')
  })
})
