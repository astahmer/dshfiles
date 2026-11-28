import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')

/** The opening tag of the JSX element that carries `marker`. */
const tagOf = (text: string, marker: string): string => {
  const at = text.indexOf(marker)
  if (at < 0) throw new Error(`no element with ${marker}`)
  return text.slice(text.lastIndexOf('<', at), text.indexOf('>\n', at))
}

describe('phone picker is one sheet, list then details in place (council picker S3)', () => {
  const picker = source('model-effort-picker.tsx')
  const details = source('model-details.tsx')
  const row = source('model-row.tsx')

  it('never scrolls sideways: edge controls take real 44 px on touch instead of a hit box that sticks out, and both scrollers clip x', () => {
    // The kit's coarse hit area (`::after`, inset to 44 px) only grows a control smaller than 44 px; at the scroller's edge
    // that growth was the 3 px (list) and 12 px (details) sideways scroll measured in round 1.
    expect(tagOf(row, 'data-model-details-trigger')).toMatch(/dshx:pointer-coarse:size-11/u)
    expect(tagOf(details, 'aria-label="Close model picker"')).toMatch(/dshx:pointer-coarse:size-11/u)
    expect(tagOf(details, 'data-model-details-back')).toMatch(/dshx:pointer-coarse:size-11/u)
    expect(tagOf(picker, 'data-model-picker-scroll')).toContain('[&_[data-slot=scroll-area-viewport]]:[overflow-x:clip]!')
    expect(tagOf(details, 'data-model-details-body')).toMatch(/dshx:\[overflow-x:clip\]/u)
    // Content scrolling under the fixed header fades over 8 px, as the list does under the search (S2).
    expect(tagOf(details, 'data-model-details-body')).toContain('mask-image:linear-gradient(to_bottom,transparent,black_8px,black_calc(100%-8px),transparent)')
  })

  it('keeps the details header (Back, title, Close) outside the scroller, 48 px tall on the sheet', () => {
    const header = tagOf(details, '<header')
    expect(header).toMatch(/dshx:shrink-0/u)
    expect(header).toMatch(/dshx:@max-pane-compact:min-h-12/u)
    expect(details.indexOf('<header')).toBeLessThan(details.indexOf('data-model-details-body'))
  })

  it('draws no card inside the sheet: no caret, 16 px insets, a fixed sheet height', () => {
    expect(picker).not.toMatch(/rotate-45/u)
    expect(tagOf(picker, 'aria-label="Choose a model"')).toMatch(/dshx:@max-pane-compact:px-2/u)
    expect(tagOf(picker, 'data-model-inspector')).toMatch(/dshx:@max-pane-compact:px-2/u)
    expect(tagOf(picker, 'data-model-inspector')).toMatch(/dshx:@max-pane-compact:border-l-0/u)
    expect(tagOf(picker, 'data-model-picker-surface')).toContain(
      'dshx:@max-pane-compact:h-[min(calc(72dvh-2rem),var(--radix-popover-content-available-height,100dvh))]',
    )
  })
})
