import { describe, expect, it } from 'vitest'
import { ComposerSnippets } from '../src/composer-snippets.js'

describe('composer quote and note chips', () => {
  it('sends a quote as a Markdown block quote under a short label', () => {
    const chip = ComposerSnippets.reference({ kind: 'quote', text: 'first line of a rather long quoted paragraph here\nsecond' })
    expect(chip.label).toBe('first line of a rather long quoted parag…')
    expect(ComposerSnippets.serialize(chip.ref)).toBe('> first line of a rather long quoted paragraph here\n> second')
  })

  it('sends a note wrapped in note tags, keeping a given label', () => {
    const chip = ComposerSnippets.reference({ kind: 'note', text: 'check the retry path', label: 'Reviewer note' })
    expect(chip.label).toBe('Reviewer note')
    expect(chip.clipboardText).toBe('check the retry path')
    expect(ComposerSnippets.serialize(chip.ref)).toBe('<note>\ncheck the retry path\n</note>')
  })

  it('refuses to send a chip whose stored text no longer decodes', () => {
    expect(() => ComposerSnippets.serialize('{"kind":"quote"}')).toThrow()
  })
})

describe('composer line-comment chips', () => {
  it('labels a comment with its file and lines and sends where it points', () => {
    const chip = ComposerSnippets.reference({ kind: 'comment', path: 'src/retry.ts', line: 12, endLine: 14, text: 'this loop never backs off' })
    expect(chip.label).toBe('retry.ts:12-14')
    expect(ComposerSnippets.serialize(chip.ref)).toBe('<comment path="src/retry.ts" lines="12-14">\nthis loop never backs off\n</comment>')
  })

  it('names a single line once', () => {
    const chip = ComposerSnippets.reference({ kind: 'comment', path: 'a.ts', line: 3, endLine: 3, text: 'typo' })
    expect(chip.clipboardText).toBe('a.ts:3 typo')
  })
})
