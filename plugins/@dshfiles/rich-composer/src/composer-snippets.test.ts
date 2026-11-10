import { describe, expect, it } from 'vitest'
import { ComposerSnippets } from './composer-snippets.ts'

const quoteRef = JSON.stringify({ kind: 'quote', text: 'Alpha\nbeta' })

describe('ComposerSnippets quote annotations', () => {
  it('stores a comment on a quote and reads it back', () => {
    const ref = ComposerSnippets.withComment(quoteRef, '  check this  ')
    expect(ComposerSnippets.annotationOf({ source: 'composer-snippet', ref })).toEqual({ comment: 'check this' })
  })

  it('removes the comment when it is cleared', () => {
    const commented = ComposerSnippets.withComment(quoteRef, 'note')
    expect(ComposerSnippets.annotationOf({ source: 'composer-snippet', ref: ComposerSnippets.withComment(commented, '   ') })).toEqual({ comment: undefined })
  })

  it('sends the comment after the quoted text', () => {
    const ref = ComposerSnippets.withComment(quoteRef, 'why?')
    expect(ComposerSnippets.serialize(ref)).toBe('> Alpha\n> beta\n\n<note>\nwhy?\n</note>')
  })

  it('leaves a quote without a comment serialized as the quote', () => {
    expect(ComposerSnippets.serialize(quoteRef)).toBe('> Alpha\n> beta')
  })

  it('reports no annotation for other chips', () => {
    expect(ComposerSnippets.annotationOf({ source: 'file-mention', ref: quoteRef })).toBeUndefined()
  })
})
