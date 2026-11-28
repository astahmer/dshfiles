import { describe, expect, it } from 'vitest'
import { SettingsColumnScroll } from './settings-column-scroll.js'

// Content coordinates of a Settings column, 600px of viewport: four groups, each a label then its rows.
const groups = [
  { top: 0, bottom: 300 },
  { top: 320, bottom: 420 }, // System: label 320–340, Hosts 344–380, Network access 382–418
  { top: 440, bottom: 620 },
  { top: 640, bottom: 760 },
]

describe('SettingsColumnScroll (council round 18 B2.4)', () => {
  it('scrolls a current row below the viewport up to its nearest edge, not to the centre', () => {
    const row = { top: 700, bottom: 736 }
    // 'nearest' puts the row's bottom on the viewport's bottom (136). That top edge cuts the first group, whose label
    // (at 0) cannot show without pushing the row out again, so the row wins.
    expect(SettingsColumnScroll.target({ scrollTop: 0, height: 600, row, groups })).toBe(136)
  })

  it('never leaves a group label hidden above rows it heads, while the current row stays in view', () => {
    // A click scrolled the current row (Plugins, 700) to the centre: the top edge (400) cuts System under its label.
    expect(SettingsColumnScroll.target({ scrollTop: 400, height: 600, row: { top: 700, bottom: 736 }, groups })).toBe(312)
  })

  it('keeps the current row in view first: a label that would push it out stays hidden', () => {
    // Showing System's label (top 312) would push a row at 950 below the viewport's bottom (912).
    expect(SettingsColumnScroll.target({ scrollTop: 400, height: 600, row: { top: 950, bottom: 986 }, groups: [...groups, { top: 780, bottom: 1000 }] })).toBe(400)
  })

  it('leaves a column alone when its current row shows and the top edge falls between groups', () => {
    expect(SettingsColumnScroll.target({ scrollTop: 430, height: 600, row: { top: 700, bottom: 736 }, groups })).toBe(430)
    expect(SettingsColumnScroll.target({ scrollTop: 0, height: 600, row: { top: 40, bottom: 76 }, groups })).toBe(0)
  })

  it('scrolls a current row above the viewport down to it and shows its own group label', () => {
    // The row (Hosts, 344) sits above the viewport (500): nearest is 344, which cuts System's label; its top is 312.
    expect(SettingsColumnScroll.target({ scrollTop: 500, height: 600, row: { top: 344, bottom: 380 }, groups })).toBe(312)
  })
})
