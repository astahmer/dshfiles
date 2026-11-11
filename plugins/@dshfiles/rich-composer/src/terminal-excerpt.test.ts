import { describe, expect, it } from 'vitest'
import { ComposerSnippets } from './composer-snippets.ts'

describe('terminal excerpt', () => {
  it('retains and serializes the selected text in its reference', () => {
    const reference = ComposerSnippets.reference({ kind: 'terminal-excerpt', text: 'first\nsecond' })
    expect(reference.label).toBe('Terminal excerpt')
    expect(ComposerSnippets.terminalExcerpt(reference.ref)).toBe('first\nsecond')
    expect(ComposerSnippets.serialize(reference.ref)).toBe('<terminal-excerpt>\nfirst\nsecond\n</terminal-excerpt>')
    expect(ComposerSnippets.terminalExcerpt('bad')).toBeUndefined()
  })

  it('labels the chip with the terminal line range it came from', () => {
    const reference = ComposerSnippets.reference({ kind: 'terminal-excerpt', text: 'first\nsecond', label: 'Terminal 3-4' })
    expect(reference.label).toBe('Terminal 3-4')
    expect(JSON.parse(reference.ref)).toEqual({ kind: 'terminal-excerpt', text: 'first\nsecond' })
    expect(ComposerSnippets.terminalExcerpt(reference.ref)).toBe('first\nsecond')
    expect(reference.clipboardText).toBe('first\nsecond')
  })
})
