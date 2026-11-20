import { describe, expect, it } from 'vitest'
import { InboxPreview } from './inbox-preview.js'

/** The question of the `user-questions/markdown-question` seed, as agent-questions states it in an item's reason. */
const MARKDOWN_QUESTION = [
  'Asks: Pick a layout for [the 0.2 release notes](https://example.test/notes)',
  '',
  'Both drafts list the same **12 changes**:',
  '',
  '| Layout | Lines |',
  '| --- | ---: |',
  '| Grouped | 48 |',
  '| Flat | 31 |',
  '',
  '```html preview Lines per layout',
  "<style>body{margin:8px;display:grid;gap:8px}.bars{display:flex;align-items:end;gap:8px;height:110px}</style><div class='bars'>",
].join('\n')

describe('inbox preview', () => {
  it('shows the first paragraph of a Markdown question as plain words', () => {
    expect(InboxPreview.firstParagraph(MARKDOWN_QUESTION)).toBe('Asks: Pick a layout for the 0.2 release notes')
  })

  it('drops tables, fenced code and HTML blocks, also when the text was cut inside a fence', () => {
    const flat = InboxPreview.flat(MARKDOWN_QUESTION)
    expect(flat).toBe('Asks: Pick a layout for the 0.2 release notes Both drafts list the same 12 changes:')
    expect(flat).not.toMatch(/[|<`*]/u)
    expect(InboxPreview.flat('Before\n\n<style>\nbody{margin:0}\n</style>\n\n<div class="bars"></div>\n\nAfter')).toBe('Before After')
    expect(InboxPreview.flat('Layout | Lines\n--- | ---\nFlat | 31\n\nWhich one?')).toBe('Which one?')
  })

  it('keeps the words of a question that opens with a fence or a heading', () => {
    expect(InboxPreview.firstParagraph('Asks: ```mermaid\ngraph TD; A-->B\n```\nWhich branch ships?')).toBe('Asks:')
    expect(InboxPreview.flat('Asks: ```mermaid\ngraph TD; A-->B\n```\nWhich branch ships?')).toBe('Asks: Which branch ships?')
    expect(InboxPreview.firstParagraph('# Release plan\n\n1. Tag\n2. Publish')).toBe('Release plan')
  })

  it('strips inline Markdown and leaves ordinary punctuation and identifiers alone', () => {
    expect(InboxPreview.firstParagraph('Use `pnpm check` on **main**, _not_ ~~master~~; see <https://example.test> and ![chart](a.png).')).toBe(
      'Use pnpm check on main, not master; see https://example.test and chart.',
    )
    expect(InboxPreview.firstParagraph('Rename session_store_id to thread_id in 2 * 3 files? (a < b)')).toBe(
      'Rename session_store_id to thread_id in 2 * 3 files? (a < b)',
    )
    expect(InboxPreview.firstParagraph('Both drafts list the same \\*\\*12 changes\\*\\*.')).toBe('Both drafts list the same **12 changes**.')
  })

  it('returns nothing for text with no prose', () => {
    expect(InboxPreview.firstParagraph('```ts\nconst a = 1\n```')).toBe('')
    expect(InboxPreview.firstParagraph('   ')).toBe('')
  })
})
