// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StatusGlyph } from '../src/components/work-status.js'

afterEach(cleanup)

/** The size class of a status's drawn mark (the svg or span inside the glyph's mark slot). */
const markSize = (status: 'ready' | 'needs-you' | 'failed' | 'working'): string | undefined => {
  const view = render(<StatusGlyph status={status} />)
  const seat = view.container.querySelector('[data-slot="status-glyph"]')!
  expect(seat.getAttribute('class')?.split(/\s+/), `${status} seat`).toContain('dshx:size-4')
  const mark = seat.querySelector('[data-glyph-mark] > *')!
  const size = mark
    .getAttribute('class')
    ?.split(/\s+/)
    .find(name => name.startsWith('dshx:size-'))
  cleanup()
  return size
}

describe('status mark sizes (round five K6)', () => {
  it('draws Ready as a 10px dot and Needs you, Failed and Working at 14px, all in the 16px seat', () => {
    expect(markSize('ready')).toBe('dshx:size-2.5')
    expect(markSize('needs-you')).toBe('dshx:size-3.5')
    expect(markSize('failed')).toBe('dshx:size-3.5')
    expect(markSize('working')).toBe('dshx:size-3.5')
  })
})
