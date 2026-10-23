import { describe, expect, it } from 'vitest'
import { prefixedTokenAt } from '../src/caret-token.js'

const at = (text: string, caret: number, prefix: '@' | '#' = '@') => prefixedTokenAt({ text, caret, prefix })

describe('prefixedTokenAt (Codex completion target port)', () => {
  it('targets the whitespace-delimited token at the caret', () => {
    expect(at('Find @deploy', 'Find @deploy'.length)).toEqual({ start: 5, end: 12, query: 'deploy' })
  })

  it('covers the part of the token right of the caret', () => {
    expect(at('@deploy later', '@dep'.length)).toEqual({ start: 0, end: 7, query: 'deploy' })
  })

  it('opens on a bare sigil', () => {
    expect(at('ask @', 5)).toEqual({ start: 4, end: 5, query: '' })
  })

  it('closes once a separator follows the token at the end of the draft', () => {
    expect(at('@deploy ', 8)).toBeNull()
  })

  it('does not search a sentence typed after the sigil', () => {
    const text = 'we should be able to @ stuff etc also'
    expect(at(text, text.length)).toBeNull()
    expect(at('@dsh trying to select it', '@dsh trying to select it'.length)).toBeNull()
  })

  it('keeps the left token when the caret sits right after it, before more text', () => {
    expect(at('@old word', '@old'.length)).toEqual({ start: 0, end: 4, query: 'old' })
  })

  it('does not cross a separator before plain text', () => {
    expect(at('@old  word', '@old '.length)).toBeNull()
  })

  it('prefers the token on the right at its start', () => {
    expect(at('@old @new', '@old '.length)).toEqual({ start: 5, end: 9, query: 'new' })
  })

  it('prefers an @ token on the right of the separator', () => {
    expect(at('@old @new', '@old'.length)).toEqual({ start: 5, end: 9, query: 'new' })
  })

  it('never gives affinity across a line break', () => {
    expect(at('@file\n  continue', '@file\n '.length)).toBeNull()
    expect(at('continue  \n@file', 'continue '.length)).toBeNull()
    expect(at('@figma \nnext', '@figma '.length)).toBeNull()
  })

  it('ignores a sigil inside another token', () => {
    expect(at('mail user@example.com', 'mail user@exa'.length)).toBeNull()
  })

  it('treats a chip as an atomic boundary', () => {
    const text = '\uFFFC@new'
    expect(at(text, text.length)).toEqual({ start: 1, end: 5, query: 'new' })
  })

  it('resolves # tokens the same way', () => {
    expect(at('note #ta', 8, '#')).toEqual({ start: 5, end: 8, query: 'ta' })
    expect(at('note #tag more', 14, '#')).toBeNull()
  })
})
