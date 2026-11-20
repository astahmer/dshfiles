import { describe, expect, it } from 'vitest'
import { ToastPlacement } from './toast-placement.js'

const viewport = { width: 1440, height: 900 }
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, width, height })

describe('ToastPlacement.bottom', () => {
  it('stays in the corner when no composer is under the toast', () => {
    expect(ToastPlacement.bottom(viewport, [])).toBe(16)
    // A composer in a narrow centre column ends left of the toast.
    expect(ToastPlacement.bottom(viewport, [rect(300, 757, 500, 88)])).toBe(16)
    // The new-thread composer sits mid-page, above the corner.
    expect(ToastPlacement.bottom(viewport, [rect(470, 300, 774, 120)])).toBe(16)
    // A hidden conversation keeps a zero-size card.
    expect(ToastPlacement.bottom(viewport, [rect(0, 0, 0, 0)])).toBe(16)
  })

  it('rises above the composer whose model picker and send button it would cover', () => {
    expect(ToastPlacement.bottom(viewport, [rect(470, 757, 774, 88)])).toBe(900 - 757 + 8)
    expect(ToastPlacement.bottom({ width: 390, height: 844 }, [rect(8, 700, 374, 96)])).toBe(844 - 700 + 8)
  })
})
