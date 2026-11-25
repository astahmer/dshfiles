// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StripOverhang } from './strip-overhang.js'

const theme = readFileSync(join(import.meta.dirname, 'dockview-theme.css'), 'utf8')
const view = readFileSync(join(import.meta.dirname, 'workbench-view.tsx'), 'utf8')

const row = (top: number, left: number): HTMLElement => {
  const element = document.createElement('div')
  element.getBoundingClientRect = () => ({ top, left, right: left + 100, bottom: top + 36, width: 100, height: 36, x: left, y: top, toJSON: () => ({}) })
  return element
}

describe('StripOverhang (council round 3 B1: one chrome)', () => {
  it('picks the tab row at the top-left corner: the topmost row, then its leftmost', () => {
    expect(StripOverhang.topStart([{ top: 0, left: 600 }, { top: 0, left: 56 }, { top: 400, left: 56 }])).toBe(1)
    expect(StripOverhang.topStart([{ top: 300, left: 56 }, { top: 0.5, left: 700 }])).toBe(1)
    expect(StripOverhang.topStart([])).toBe(-1)
  })

  it('marks only that row, and moves the mark when the layout changes', () => {
    const left = row(0, 56)
    const right = row(0, 700)
    StripOverhang.markRows([right, left])
    expect(left.hasAttribute(StripOverhang.ROW_ATTRIBUTE)).toBe(true)
    expect(right.hasAttribute(StripOverhang.ROW_ATTRIBUTE)).toBe(false)
    StripOverhang.markRows([right])
    expect(right.hasAttribute(StripOverhang.ROW_ATTRIBUTE)).toBe(true)
  })

  it('keeps the root mark while any main region is mounted', () => {
    const root = document.createElement('html')
    const first = StripOverhang.mount(root)
    const second = StripOverhang.mount(root)
    first()
    expect(root.hasAttribute(StripOverhang.ROOT_ATTRIBUTE)).toBe(true)
    second()
    expect(root.hasAttribute(StripOverhang.ROOT_ATTRIBUTE)).toBe(false)
  })

  it('pads the marked row by the published overhang, only in the main region', () => {
    expect(theme).toMatch(/\.dv-tabs-and-actions-container\[data-workbench-top-start\] \{\s*padding-inline-start: var\(--dshfiles-sidebar-overhang, 0px\);/u)
    expect(view).toContain("if (api === null || region !== 'main') return")
    expect(view).toContain('StripOverhang.markRows(')
  })
})
