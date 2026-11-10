import { describe, expect, it } from 'vitest'
import { parseStoredDraft } from './native/draft.ts'

const reference = {
  source: 'file',
  ref: 'src/a.ts',
  offset: 9,
  length: 9,
  label: 'a.ts',
  appearance: 'file',
  clipboardText: '@src/a.ts',
}

describe('stored draft decoding', () => {
  it('accepts the earlier plain-string representation', () => {
    expect(parseStoredDraft('plain text')).toEqual({ text: 'plain text', references: [] })
  })

  it('keeps a reference naming an ordered span after the leading command token', () => {
    expect(parseStoredDraft({ text: '/compact @src/a.ts now', command: { token: '/compact' }, references: [reference] })).toEqual({
      text: '/compact @src/a.ts now',
      command: { token: '/compact' },
      references: [reference],
    })
  })

  it('strips properties the snapshot does not declare', () => {
    expect(parseStoredDraft({ text: 'plain', references: [], editorState: { selection: 4 } })).toEqual({ text: 'plain', references: [] })
  })

  it('rejects a reference whose span does not match the draft text', () => {
    expect(
      parseStoredDraft({ text: '/compact @src/a.ts now', command: { token: '/compact' }, references: [{ ...reference, clipboardText: '@src/b.ts' }] }),
    ).toBeUndefined()
  })

  it('rejects overlapping references', () => {
    const overlap = { ...reference, offset: 10, clipboardText: 'src/a.ts ', length: 9 }
    expect(parseStoredDraft({ text: '/compact @src/a.ts now', command: { token: '/compact' }, references: [reference, overlap] })).toBeUndefined()
  })

  it('rejects a command token the text does not start with', () => {
    expect(parseStoredDraft({ text: 'ask /compact', command: { token: '/compact' }, references: [] })).toBeUndefined()
  })

  it('rejects an empty command token', () => {
    expect(parseStoredDraft({ text: 'plain', command: { token: '' }, references: [] })).toBeUndefined()
  })

  it('rejects a negative offset or a non-positive length', () => {
    expect(parseStoredDraft({ text: 'plain text', references: [{ ...reference, offset: -1 }] })).toBeUndefined()
    expect(parseStoredDraft({ text: 'plain text', references: [{ ...reference, length: 0 }] })).toBeUndefined()
  })

  it('rejects an unknown appearance', () => {
    expect(
      parseStoredDraft({ text: '/compact @src/a.ts now', command: { token: '/compact' }, references: [{ ...reference, appearance: 'pane' }] }),
    ).toBeUndefined()
  })
})
