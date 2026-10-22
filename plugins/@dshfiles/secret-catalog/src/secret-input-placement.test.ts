import { describe, expect, it } from 'vitest'
import { placeSecretButton, placeSecretPanel, type AnchorBounds } from './secret-input-placement.js'

const viewport = { width: 1280, height: 800 }
const panel = { width: 320, height: 300 }
const anchor = (top: number, height = 40) => ({ left: 200, top, right: 900, bottom: top + height }) satisfies AnchorBounds

describe('secret picker placement', () => {
  it('opens below a field that has room underneath', () => {
    const placement = placeSecretPanel({ anchor: anchor(100), panel, viewport })
    expect(placement).toEqual({ side: 'bottom', left: 580, top: 146, maxHeight: 646 })
  })

  it('flips above a field near the bottom instead of leaving the viewport', () => {
    const placement = placeSecretPanel({ anchor: anchor(700), panel, viewport })
    expect(placement).toEqual({ side: 'top', left: 580, top: 394, maxHeight: 686 })
    expect(placement.top + panel.height).toBeLessThanOrEqual(viewport.height - 8)
  })

  it('caps its height when neither side fits the whole panel', () => {
    const placement = placeSecretPanel({ anchor: anchor(180), panel, viewport: { width: 1280, height: 400 } })
    expect(placement.side).toBe('bottom')
    expect(placement.maxHeight).toBe(166)
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(392)
  })

  it('covers the field from the top when neither side has usable room', () => {
    const placement = placeSecretPanel({ anchor: anchor(20, 80), panel, viewport: { width: 1280, height: 120 } })
    expect(placement).toEqual({ side: 'bottom', left: 580, top: 8, maxHeight: 104 })
  })

  it('keeps the panel off the horizontal edges', () => {
    const left = placeSecretPanel({ anchor: { left: 0, top: 100, right: 40, bottom: 140 }, panel, viewport })
    const right = placeSecretPanel({ anchor: { left: 1200, top: 100, right: 1276, bottom: 140 }, panel, viewport })
    expect(left.left).toBe(8)
    expect(right.left).toBe(952)
  })

  it('keeps the secret action on screen when the field runs past an edge', () => {
    expect(placeSecretButton({ anchor: { left: 0, top: 300, right: 20, bottom: 340 }, viewport })).toEqual({ left: 8, top: 308 })
    expect(placeSecretButton({ anchor: { left: 1250, top: 790, right: 1290, bottom: 830 }, viewport })).toEqual({ left: 1248, top: 768 })
  })

  it('places a wider labeled action inside the viewport', () => {
    expect(placeSecretButton({ anchor: { left: 1200, top: 300, right: 1276, bottom: 340 }, viewport, width: 104, height: 28 })).toEqual({
      left: 1166,
      top: 306,
    })
  })

  it('places a labeled setting action after its label', () => {
    expect(placeSecretButton({ anchor: { left: 380, top: 503, right: 468, bottom: 523 }, viewport, width: 104, height: 28, align: 'after' })).toEqual({
      left: 474,
      top: 499,
    })
  })
})
