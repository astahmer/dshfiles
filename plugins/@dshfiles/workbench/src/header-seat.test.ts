// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { HeaderSeats, SEAT_MIN_FREE_PX, type SeatGroup, type SeatPanel } from './header-seat.js'

const group = (options: { readonly width: number; readonly hidden?: boolean }): SeatGroup => {
  const element = document.createElement('div')
  element.innerHTML =
    '<div class="dv-tabs-and-actions-container"><div class="dv-scrollable"><div class="dv-tabs-container"></div></div><div class="dv-void-container"></div><div class="dv-right-actions-container"></div></div>'
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: options.width })
  document.body.append(element)
  return { element, header: { hidden: options.hidden ?? false } }
}
const panel = (owner: SeatGroup, visible = true): SeatPanel => ({ group: owner, isVisible: visible })

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.removeAttribute('data-shell-phone-nav')
  document.documentElement.removeAttribute('data-workbench-main-tabs')
  document.documentElement.removeAttribute('data-dshfiles-zen')
})

describe('HeaderSeats', () => {
  it('seats the visible panel of a wide group between its tabs and its pane actions, once', () => {
    const wide = group({ width: SEAT_MIN_FREE_PX + 200 })
    const seat = HeaderSeats.resolve(panel(wide))
    expect(seat).not.toBeNull()
    const children = [...(wide.element.firstElementChild?.children ?? [])].map(child => child.className || child.getAttribute('data-workbench-header-seat'))
    expect(children).toEqual(['dv-scrollable', 'dv-void-container', '', 'dv-right-actions-container'])
    expect(HeaderSeats.resolve(panel(wide))).toBe(seat)
  })

  it('keeps the header inline for a hidden tab, a hidden tab row, a narrow split or a crowded tab row', () => {
    expect(HeaderSeats.resolve(panel(group({ width: 1200 }), false))).toBeNull()
    expect(HeaderSeats.resolve(panel(group({ width: 1200, hidden: true })))).toBeNull()
    expect(HeaderSeats.resolve(panel(group({ width: SEAT_MIN_FREE_PX - 1 })))).toBeNull()
    const crowded = group({ width: 1200 })
    const tabs = crowded.element.querySelector('.dv-tabs-container')
    if (tabs !== null) Object.defineProperty(tabs, 'scrollWidth', { configurable: true, value: 700 })
    expect(HeaderSeats.resolve(panel(crowded))).toBeNull()
  })

  it('renders the header inline in the main region while its tab rows are hidden, and seats it otherwise', () => {
    const region = document.createElement('div')
    region.setAttribute('data-workbench-region', 'main')
    document.body.append(region)
    const main = group({ width: 1400 })
    region.append(main.element)
    const right = group({ width: 1400 })
    // Tabs shown (the default since b:4v6p): the main region keeps its seat.
    document.documentElement.setAttribute('data-workbench-main-tabs', 'shown')
    expect(HeaderSeats.resolve(panel(main))).not.toBeNull()
    document.documentElement.setAttribute('data-workbench-main-tabs', 'hidden')
    expect(HeaderSeats.resolve(panel(main))).toBeNull()
    expect(HeaderSeats.resolve(panel(right))).not.toBeNull()
    // One sidebar layout (b:952m): no shell attribute brings the rows back; only the setting does.
    document.documentElement.setAttribute('data-shell-layout', 'docking')
    expect(HeaderSeats.resolve(panel(main))).toBeNull()
    document.documentElement.removeAttribute('data-shell-layout')
    document.documentElement.setAttribute('data-workbench-main-tabs', 'shown')
    expect(HeaderSeats.resolve(panel(main))).not.toBeNull()
  })

  it('renders the main header inline in zen mode and seats it again on leaving, with the setting still shown', () => {
    const region = document.createElement('div')
    region.setAttribute('data-workbench-region', 'main')
    document.body.append(region)
    const main = group({ width: 1400 })
    region.append(main.element)
    const right = group({ width: 1400 })
    document.documentElement.setAttribute('data-workbench-main-tabs', 'shown')
    document.documentElement.setAttribute('data-dshfiles-zen', 'on')
    expect(HeaderSeats.resolve(panel(main))).toBeNull()
    expect(HeaderSeats.resolve(panel(right))).not.toBeNull()
    document.documentElement.removeAttribute('data-dshfiles-zen')
    expect(HeaderSeats.resolve(panel(main))).not.toBeNull()
  })
})
