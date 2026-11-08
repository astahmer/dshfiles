// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { observeControlRow } from './control-row-layout.ts'

// jsdom has no layout: each group reports a width that depends on the row's
// collapse flags, the way InputBar.module.css sizes them (compact drops the
// effort chip and tightens the gaps).
const EXPANDED = { tools: 128, trailing: 270, gap: 12 }
const COMPACT = { tools: 116, trailing: 232, gap: 8 }
const PADDING = 8

let rowWidth = 0
let notify: (() => void) | undefined

const sizes = (row: HTMLElement): typeof EXPANDED => (row.hasAttribute('data-model-compact') ? COMPACT : EXPANDED)

function mountRow(): HTMLElement {
  const row = document.createElement('div')
  const tools = document.createElement('div')
  const trailing = document.createElement('div')
  row.append(tools, trailing)
  document.body.append(row)
  const rect = (width: () => number) => () => ({ width: width() }) as DOMRect
  row.getBoundingClientRect = rect(() => rowWidth)
  tools.getBoundingClientRect = rect(() => sizes(row).tools)
  trailing.getBoundingClientRect = rect(() => sizes(row).trailing)
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => ({
    paddingLeft: `${PADDING}px`,
    paddingRight: `${PADDING}px`,
    columnGap: `${element === row ? sizes(row).gap : 0}px`,
  }) as CSSStyleDeclaration)
  return row
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notify = callback }
    observe(): void {}
    disconnect(): void {}
  })
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { addEventListener: () => {}, removeEventListener: () => {} },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
  notify = undefined
})

const flags = (row: HTMLElement) => ({
  compact: row.hasAttribute('data-model-compact'),
  wrap: row.hasAttribute('data-controls-wrap'),
})

describe('observeControlRow', () => {
  it('keeps both groups expanded on one line when they fit', () => {
    rowWidth = 1024
    const row = mountRow()
    const stop = observeControlRow(row)
    expect(flags(row)).toEqual({ compact: false, wrap: false })
    stop()
  })

  it('compacts before wrapping when the compact groups share a line (split pane)', () => {
    // 386px card: 370 available; expanded needs 410, compact needs 356.
    rowWidth = 386
    const row = mountRow()
    const stop = observeControlRow(row)
    expect(flags(row)).toEqual({ compact: true, wrap: false })
    stop()
  })

  it('wraps control by control only when even the compact groups overflow (phone)', () => {
    // 356px card: 340 available; compact still needs 356.
    rowWidth = 356
    const row = mountRow()
    const stop = observeControlRow(row)
    expect(flags(row)).toEqual({ compact: true, wrap: true })
    stop()
  })

  it('clears both steps when the row widens again', () => {
    rowWidth = 356
    const row = mountRow()
    const stop = observeControlRow(row)
    rowWidth = 1024
    notify?.()
    expect(flags(row)).toEqual({ compact: false, wrap: false })
    stop()
  })
})
