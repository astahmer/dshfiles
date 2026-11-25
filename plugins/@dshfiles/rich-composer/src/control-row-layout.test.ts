// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { observeControlRow } from './native/skeleton/control-row-layout.ts'

const LINE = 28
const ROW_GAP = 4

/**
 * A row of fixed-width items whose widths shrink as the collapse steps apply, as the real CSS does: the compact step
 * drops labels, the icon step drops the model name. The row reports the height a browser would give it — one line, or
 * two lines plus the row gap when the simulated layout wraps.
 */
const rowOf = (input: {
  readonly available: number
  readonly expanded: number[]
  readonly compact: number[]
  readonly icon: number[]
  /** Whether the laid-out row takes a second line (default: never). */
  readonly wraps?: (row: HTMLElement) => boolean
}) => {
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
  const wraps = input.wraps ?? (() => false)
  row.getBoundingClientRect = () => new DOMRect(0, 0, input.available, wraps(row) ? 2 * LINE + ROW_GAP : LINE)
  items.forEach((item, index) => {
    item.getBoundingClientRect = () => new DOMRect(0, 0, widthOf(index), LINE)
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
    const row = rowOf({
      available: 260,
      expanded: [28, 90, 28, 140, 32],
      compact: [28, 28, 28, 90, 32],
      icon: [28, 28, 28, 28, 32],
      wraps: row => !row.hasAttribute('data-model-compact'),
    })
    const stop = observeControlRow(row)
    expect(row.hasAttribute('data-model-compact')).toBe(true)
    expect(row.hasAttribute('data-model-icon')).toBe(false)
    stop()
  })

  it('shows the model as an icon in a pane too narrow for its name', () => {
    const row = rowOf({
      available: 170,
      expanded: [28, 90, 28, 140, 32],
      compact: [28, 28, 28, 90, 32],
      icon: [28, 28, 28, 28, 32],
      wraps: () => true,
    })
    const stop = observeControlRow(row)
    expect(row.hasAttribute('data-model-compact')).toBe(true)
    expect(row.hasAttribute('data-model-icon')).toBe(true)
    stop()
  })
})

describe('the new-thread bar (b:gyk7)', () => {
  it('stops at the compact step and wraps instead of showing the model as an icon', () => {
    const row = rowOf({
      available: 170,
      expanded: [28, 90, 28, 140, 32],
      compact: [28, 28, 28, 90, 32],
      icon: [28, 28, 28, 28, 32],
      wraps: () => true,
    })
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

describe('a bar the browser wraps while the summed widths still read as fitting', () => {
  it('collapses on the laid-out wrap instead of trusting the sum', () => {
    // A real new-thread bar at ~780px: the visible items sum to 656.92 + 4 gaps, but the empty plugin anchors still
    // cost a gap each and the + control carries a 4px margin, so the browser wraps at 674px of content width. The
    // summed estimate said "fits"; the collapse then fought the wrap and the bar swapped lines on every pass.
    const row = rowOf({
      available: 674,
      expanded: [28, 111.86, 90.86, 138.84, 287.36],
      compact: [28, 107.86, 83.02, 131, 248.48],
      icon: [28, 28, 28, 28, 28],
      wraps: row => !row.hasAttribute('data-model-compact'),
    })
    const stop = observeControlRow(row)
    expect(row.hasAttribute('data-model-compact')).toBe(true)
    stop()
  })
})

describe('a resize the collapse caused itself', () => {
  const observeWithResizes = (row: HTMLElement) => {
    const callbacks: (() => void)[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          callbacks.push(callback)
        }
        observe(): void {}
        disconnect(): void {}
      },
    )
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    const stop = observeControlRow(row)
    return { resized: () => callbacks.forEach(callback => callback()), stop }
  }

  it('keeps the collapsed controls instead of expanding and collapsing them again, which shook the composer', () => {
    const row = rowOf({
      available: 260,
      expanded: [28, 90, 28, 140, 32],
      compact: [28, 28, 28, 90, 32],
      icon: [28, 28, 28, 28, 32],
      wraps: row => !row.hasAttribute('data-model-compact'),
    })
    const { resized, stop } = observeWithResizes(row)
    expect(row.hasAttribute('data-model-compact')).toBe(true)
    const removed = vi.spyOn(row, 'removeAttribute')
    // The collapse changed a wrapping row's height, so the observer reports the row: nothing it measures has changed.
    resized()
    resized()
    expect(removed).not.toHaveBeenCalled()
    expect(row.hasAttribute('data-model-compact')).toBe(true)
    stop()
  })

  it('ignores sub-pixel jitter instead of re-deciding the collapse on every frame', () => {
    const row = rowOf({
      available: 674,
      expanded: [28, 111.86, 90.86, 138.84, 287.36],
      compact: [28, 107.86, 83.02, 131, 248.48],
      icon: [28, 28, 28, 28, 28],
      wraps: row => !row.hasAttribute('data-model-compact'),
    })
    const { resized, stop } = observeWithResizes(row)
    expect(row.hasAttribute('data-model-compact')).toBe(true)
    const item = row.children[1]
    if (item === undefined) throw new Error('the row has no second item')
    // The line re-flowed: an item's fractional width drifted and the row's height changed with it, while the row's own
    // width stayed put. Re-measuring on that drift re-decided the collapse every frame and the bar swapped lines.
    item.getBoundingClientRect = () => new DOMRect(0, 0, 108.26, LINE)
    row.getBoundingClientRect = () => new DOMRect(0, 0, 674, 2 * LINE + ROW_GAP)
    const removed = vi.spyOn(row, 'removeAttribute')
    resized()
    expect(removed).not.toHaveBeenCalled()
    stop()
  })

  it('still measures again when the row really changes width', () => {
    const row = rowOf({
      available: 260,
      expanded: [28, 90, 28, 140, 32],
      compact: [28, 28, 28, 90, 32],
      icon: [28, 28, 28, 28, 32],
      wraps: row => !row.hasAttribute('data-model-compact'),
    })
    const { resized, stop } = observeWithResizes(row)
    expect(row.hasAttribute('data-model-compact')).toBe(true)
    row.getBoundingClientRect = () => new DOMRect(0, 0, 600, LINE)
    resized()
    expect(row.hasAttribute('data-model-compact')).toBe(false)
    row.getBoundingClientRect = () => new DOMRect(0, 0, 170, 2 * LINE + ROW_GAP)
    resized()
    expect(row.hasAttribute('data-model-icon')).toBe(true)
    stop()
  })
})

describe('Send positioned outside the line (unslop phone 6)', () => {
  it('does not count Send, which a narrow card seats beside the row, so a bar that fits keeps the mode words', () => {
    // + · "Can edit" · ⋯ · model fit 292px; Send (36px) sits against the card, outside the row's box.
    const row = rowOf({ available: 292, expanded: [44, 105, 32, 95, 36], compact: [44, 30, 32, 95, 36], icon: [44, 30, 32, 32, 36] })
    const send = row.lastElementChild
    if (!(send instanceof HTMLElement)) throw new Error('the row has no Send')
    send.style.position = 'absolute'
    const stop = observeControlRow(row)
    expect(row.hasAttribute('data-model-compact')).toBe(false)
    stop()
  })
})

describe("a phone's bar (unslop r5 C3)", () => {
  it('takes the mark step even when the words would fit, so the model is its brand mark and the mode its icon', () => {
    // The phone bar shrank the model seat instead of overflowing, so no step ever applied and the chip read "gpt-…".
    const row = rowOf({ available: 292, expanded: [44, 105, 32, 95], compact: [44, 30, 32, 95], icon: [44, 30, 32, 32] })
    const stop = observeControlRow(row, { markStep: () => true })
    expect(row.hasAttribute('data-model-compact')).toBe(true)
    expect(row.hasAttribute('data-model-mark')).toBe(true)
    // The mark is the icon: the CPU glyph step stays for a model without one.
    expect(row.hasAttribute('data-model-icon')).toBe(false)
    stop()
  })

  it('leaves a wider bar to the content-sized steps', () => {
    const row = rowOf({ available: 600, expanded: [28, 90, 28, 140, 32], compact: [28, 28, 28, 90, 32], icon: [28, 28, 28, 28, 32] })
    const stop = observeControlRow(row, { markStep: () => false })
    expect(row.hasAttribute('data-model-mark')).toBe(false)
    expect(row.hasAttribute('data-model-compact')).toBe(false)
    stop()
  })

  it('draws the model trigger as its 16px brand mark in a 24px chip, and only when it has a mark', async () => {
    const { readFileSync } = await import('node:fs')
    const { dirname, resolve } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'native/skeleton/InputBar.module.css'), 'utf8')
    const trigger = ".row[data-model-mark] :global([data-model-trigger]:has(svg[data-brand]))"
    expect(css).toMatch(new RegExp(`${trigger.replace(/[[\]().:]/g, '\\$&')} \\{[^}]*padding-inline: 4px`))
    expect(css).toContain(`${trigger} :is(:global([data-model-picker-text]), :global([data-model-picker-provider]))`)
    expect(css).toMatch(/\.row\[data-model-mark\] :global\(\[data-model-trigger\]\) :global\(svg\[data-brand\]\) \{\s*width: 16px;\s*height: 16px;/)
    // Zero-width plugin anchors each cost a gap, so the mark step drops them like the icon step: + · mode · ⋯ · model.
    expect(css).toMatch(/\.row:is\(\[data-model-icon\], \[data-model-mark\]\) \.standardControls \{\s*column-gap: 0;/)
  })
})
