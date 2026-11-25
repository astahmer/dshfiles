// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { SelectionAnnotation } from '../src/annotate-selection.ts'
import { columnLeft, markerPlacement, stackTops, type AnnotationAnchor } from '../src/native/chat/annotation-anchors.ts'

// jsdom has no layout; an empty rect stands in for whatever the browser measured.
Range.prototype.getBoundingClientRect ??= () => DOMRect.fromRect()
Range.prototype.getClientRects ??= () => document.createElement('div').getClientRects()

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const render = (html: string): HTMLElement => {
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.append(container)
  cleanups.push(() => container.remove())
  return container
}

describe('SelectionAnnotation.rangeOf', () => {
  it('maps a quote onto the text that holds it, ignoring markup and extra whitespace', () => {
    const container = render('<p id="block">Hook ordering. <strong>Free-form</strong> middleware ends\nhere.</p>')
    const block = container.querySelector('#block')
    if (block === null) throw new Error('fixture missing')
    expect(SelectionAnnotation.rangeOf({ block, text: 'Free-form middleware' })?.toString()).toBe('Free-form middleware')
  })

  it('returns undefined when the paragraph no longer holds the quote', () => {
    const container = render('<p id="block">Delta epsilon.</p>')
    const block = container.querySelector('#block')
    if (block === null) throw new Error('fixture missing')
    expect(SelectionAnnotation.rangeOf({ block, text: 'Zeta eta.' })).toBeUndefined()
  })
})

const column = { left: 100, top: 0, right: 780, bottom: 900 }
const bound = { top: 40, bottom: 800 }

const anchor = (marker: { left: number; top: number; right: number; bottom: number } = { left: 100, top: 200, right: 700, bottom: 240 }): AnnotationAnchor => ({
  annotation: { id: 1, text: 'Where do operations stop?', comment: '', source: 'step=s1&block=0' },
  block: document.createElement('p'),
  text: marker,
  marker,
})

describe('markerPlacement', () => {
  it('sits in the gutter right of the transcript column', () => {
    expect(markerPlacement({ anchor: anchor(), mode: 'popover', column, bound, windowWidth: 1400 })).toEqual({ left: 786, top: 201 })
  })

  it('sits past the quoted line in inline shape, clamped to the window', () => {
    expect(markerPlacement({ anchor: anchor(), mode: 'inline', column, bound, windowWidth: 1400 })).toEqual({ left: 704, top: 201 })
    expect(markerPlacement({ anchor: anchor(), mode: 'inline', column, bound, windowWidth: 710 }).left).toBe(684)
  })

  it('never lands under the composer', () => {
    const low = anchor({ left: 100, top: 790, right: 700, bottom: 830 })
    expect(markerPlacement({ anchor: low, mode: 'popover', column, bound, windowWidth: 1400 }).top).toBe(bound.bottom - 18 - 4)
  })
})

describe('columnLeft', () => {
  it('uses the gap beside the column when it fits', () => {
    expect(columnLeft({ column, width: 248, windowWidth: 1400, gap: 24 })).toBe(804)
  })

  it('declines when the window leaves no room', () => {
    expect(columnLeft({ column, width: 248, windowWidth: 1040, gap: 24 })).toBeUndefined()
  })
})

describe('stackTops', () => {
  it('pushes a card below the one above it', () => {
    expect(stackTops({ tops: [200, 230], heights: [80, 60], gap: 8, bound })).toEqual([200, 288])
  })

  it('keeps a tall card inside the band', () => {
    expect(stackTops({ tops: [760], heights: [120], gap: 8, bound: { top: 40, bottom: 800 } })).toEqual([676])
  })
})
