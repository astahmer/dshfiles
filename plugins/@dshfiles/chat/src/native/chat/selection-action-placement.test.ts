import { describe, expect, it } from 'vitest'
import { annotatePlacement, touchActionPlacement, withinViewport } from './selection-action-placement.ts'

const phone = { offsetLeft: 0, offsetTop: 0, width: 390, height: 844 }
const selection = { left: 40, top: 300, right: 260, bottom: 340 }
const end = { left: 20, top: 320, right: 160, bottom: 340 }

describe('touchActionPlacement', () => {
  const transcript = { left: 0, top: 44, right: 390, bottom: 760 }

  it('puts the quote action under the selection end, clear of the handles, not above where the native toolbar sits', () => {
    const placed = touchActionPlacement({ end, width: 100, height: 44, bounds: transcript })
    expect(placed.top).toBe(end.bottom + 32)
    expect(placed.left).toBe(end.right - 50)
  })

  it('stays inside the visual viewport when the keyboard shrinks it', () => {
    const keyboardOpen = { offsetLeft: 0, offsetTop: 0, width: 390, height: 420 }
    const nearBottom = { left: 300, top: 400, right: 388, bottom: 416 }
    const bounds = withinViewport({ bounds: transcript, viewport: keyboardOpen })
    const placed = touchActionPlacement({ end: nearBottom, width: 100, height: 44, bounds })
    expect(placed.top + 44).toBeLessThanOrEqual(420)
    expect(placed.left + 100).toBeLessThanOrEqual(390)
  })
})

describe('annotatePlacement', () => {
  it('keeps desktop centred above the selection, clamped to the window', () => {
    expect(annotatePlacement({ selection, end, windowWidth: 1280, viewport: phone, touch: false, buttonWidth: 110 }))
      .toEqual({ left: 150, top: 300, side: 'above' })
    expect(annotatePlacement({ selection: { ...selection, left: 0, right: 20 }, end, windowWidth: 1280, viewport: phone, touch: false, buttonWidth: 110 }).left)
      .toBe(72)
  })

  it('puts the touch button under the selection end, clear of the selection handles', () => {
    const placed = annotatePlacement({ selection, end, windowWidth: 390, viewport: phone, touch: true, buttonWidth: 130 })
    expect(placed.side).toBe('below')
    expect(placed.left).toBe(160)
    expect(placed.top).toBeGreaterThanOrEqual(end.bottom + 32)
  })

  it('keeps the touch button inside the visual viewport above the keyboard', () => {
    const keyboardOpen = { offsetLeft: 0, offsetTop: 120, width: 390, height: 400 }
    const nearBottom = { left: 300, top: 500, right: 385, bottom: 510 }
    const placed = annotatePlacement({ selection: nearBottom, end: nearBottom, windowWidth: 390, viewport: keyboardOpen, touch: true, buttonWidth: 130 })
    expect(placed.top + 44).toBeLessThanOrEqual(keyboardOpen.offsetTop + keyboardOpen.height)
    expect(placed.left + 65).toBeLessThanOrEqual(390)
  })

  it('steps under the touch Quote action instead of covering it, or above it without room below', () => {
    const quote = { left: 110, top: 372, right: 210, bottom: 416 }
    const placed = annotatePlacement({ selection, end, windowWidth: 390, viewport: phone, touch: true, buttonWidth: 130, avoid: quote })
    expect(placed.top).toBe(quote.bottom + 8)
    const short = { offsetLeft: 0, offsetTop: 0, width: 390, height: 440 }
    const squeezed = annotatePlacement({ selection, end, windowWidth: 390, viewport: short, touch: true, buttonWidth: 130, avoid: quote })
    expect(squeezed.top + 44).toBeLessThanOrEqual(quote.top)
  })

  it('follows a pinch-zoomed visual viewport', () => {
    const zoomed = { offsetLeft: 200, offsetTop: 400, width: 195, height: 422 }
    const placed = annotatePlacement({ selection, end, windowWidth: 390, viewport: zoomed, touch: true, buttonWidth: 130 })
    expect(placed.top).toBeGreaterThanOrEqual(zoomed.offsetTop)
    expect(placed.left - 65).toBeGreaterThanOrEqual(zoomed.offsetLeft)
  })
})
