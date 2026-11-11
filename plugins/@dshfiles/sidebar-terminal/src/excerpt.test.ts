import { expect, it } from 'vitest'
import { excerptLabel, excerptOf, excerptOfLines, MAX_EXCERPT_CHARS, type TerminalSelectionSource } from './native/client/excerpt.ts'

const source = (
  text: string,
  position: { readonly start: { readonly x: number; readonly y: number }; readonly end: { readonly x: number; readonly y: number } } | undefined,
): TerminalSelectionSource => ({
  hasSelection: () => position !== undefined,
  getSelection: () => text,
  getSelectionPosition: () => position,
})

it('labels a one-line selection with its 1-based line', () => {
  expect(excerptLabel(3, 3)).toBe('Terminal 3')
  expect(excerptLabel(3, 9)).toBe('Terminal 3-9')
})

it('reads no selection as no excerpt', () => {
  expect(excerptOf(source('', undefined))).toBeUndefined()
  expect(excerptOf(source('   \n\t\n', { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } }))).toBeUndefined()
})

it('keeps the 1-based buffer line range of the selection', () => {
  const excerpt = excerptOf(source('first\nsecond\n', { start: { x: 0, y: 2 }, end: { x: 6, y: 3 } }))
  expect(excerpt).toEqual({ text: 'first\nsecond', label: 'Terminal 3-4' })
})

it('does not count the row a trailing selection edge opens', () => {
  const excerpt = excerptOf(source('first\nsecond\n', { start: { x: 4, y: 0 }, end: { x: 0, y: 2 } }))
  expect(excerpt?.label).toBe('Terminal 1-2')
})

it('bounds a long selection and marks the cut', () => {
  const excerpt = excerptOfLines({ text: 'x'.repeat(MAX_EXCERPT_CHARS * 2), firstLine: 1, lastLine: 1 })
  expect(excerpt?.text).toHaveLength(MAX_EXCERPT_CHARS)
  expect(excerpt?.text.endsWith('…')).toBe(true)
})

it('never splits a surrogate pair when it bounds a selection', () => {
  const excerpt = excerptOfLines({ text: `${'x'.repeat(MAX_EXCERPT_CHARS - 2)}😀tail`, firstLine: 1, lastLine: 1 })
  expect(excerpt?.text).toBe(`${'x'.repeat(MAX_EXCERPT_CHARS - 2)}…`)
})
