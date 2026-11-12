// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { observeControlRow } from './native/skeleton/control-row-layout.ts'

/**
 * A row of fixed-width items whose widths shrink as the collapse steps apply, as the real CSS does: the compact step
 * drops labels, the icon step drops the model name.
 */
const rowOf = (input: { readonly available: number; readonly expanded: number[]; readonly compact: number[]; readonly icon: number[] }) => {
  const row = document.createElement('div')
  row.style.padding = '0px'
  row.style.columnGap = '4px'
  const items = input.expanded.map(() => row.appendChild(document.createElement('span')))
  const widthOf = (index: number): number =>
    row.hasAttribute('data-model-icon')
      ? (input.icon[index] ?? 0)
      : row.hasAttribute('data-model-compact')
        ? (input.compact[index] ?? 0)
        : (input.expanded[index] ?? 0)
  row.getBoundingClientRect = () => new DOMRect(0, 0, input.available, 0)
  items.forEach((item, index) => {
    item.getBoundingClientRect = () => new DOMRect(0, 0, widthOf(index), 0)
  })
  document.body.append(row)
  return row
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  )
  Object.defineProperty(document, 'fonts', { configurable: true, value: { addEventListener: () => undefined, removeEventListener: () => undefined } })
})

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('the composer control row collapse (b:gyk7)', () => {
  it('keeps every label when the row fits', () => {
    const row = rowOf({ available: 600, expanded: [28, 90, 28, 140, 32], compact: [28, 28, 28, 90, 32], icon: [28, 28, 28, 28, 32] })
    const stop = observeControlRow(row)
    expect(row.hasAttribute('data-model-compact')).toBe(false)
    expect(row.hasAttribute('data-model-icon')).toBe(false)
    stop()
  })

  it('drops labels first and keeps the model name while that is enough', () => {
    const row = rowOf({ available: 260, expanded: [28, 90, 28, 140, 32], compact: [28, 28, 28, 90, 32], icon: [28, 28, 28, 28, 32] })
    const stop = observeControlRow(row)
    expect(row.hasAttribute('data-model-compact')).toBe(true)
    expect(row.hasAttribute('data-model-icon')).toBe(false)
    stop()
  })

  it('shows the model as an icon in a pane too narrow for its name', () => {
    const row = rowOf({ available: 170, expanded: [28, 90, 28, 140, 32], compact: [28, 28, 28, 90, 32], icon: [28, 28, 28, 28, 32] })
    const stop = observeControlRow(row)
    expect(row.hasAttribute('data-model-compact')).toBe(true)
    expect(row.hasAttribute('data-model-icon')).toBe(true)
    stop()
  })
})

describe('the new-thread bar (b:gyk7)', () => {
  it('stops at the compact step and wraps instead of showing the model as an icon', () => {
    const row = rowOf({ available: 170, expanded: [28, 90, 28, 140, 32], compact: [28, 28, 28, 90, 32], icon: [28, 28, 28, 28, 32] })
    const stop = observeControlRow(row, { iconStep: () => false })
    expect(row.hasAttribute('data-model-compact')).toBe(true)
    expect(row.hasAttribute('data-model-icon')).toBe(false)
    stop()
  })
})

describe('an item on a line of its own (b:4qjm)', () => {
  it('leaves the phone place chip out of the line it would otherwise crowd', () => {
    const row = rowOf({ available: 200, expanded: [300, 28, 90, 28], compact: [300, 28, 40, 28], icon: [300, 28, 40, 28] })
    const place = row.firstElementChild
    if (!(place instanceof HTMLElement)) throw new Error('the row has no place chip')
    place.setAttribute('data-row-break', '')
    place.style.flexBasis = '100%'
    const stop = observeControlRow(row)
    expect(row.hasAttribute('data-model-compact')).toBe(false)
    stop()
  })
})
