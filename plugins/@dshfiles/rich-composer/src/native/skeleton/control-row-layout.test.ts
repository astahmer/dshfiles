// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { observeControlRow } from './control-row-layout.js'

type Size = { readonly width: number }
interface DeliveredEntry {
  readonly target: Element
  readonly contentRect: Size
  readonly contentBoxSize: readonly { readonly inlineSize: number }[]
  readonly borderBoxSize: readonly { readonly inlineSize: number }[]
}

class FakeResizeObserver {
  static current: FakeResizeObserver | null = null
  readonly targets = new Set<Element>()
  constructor(private readonly callback: (entries: readonly DeliveredEntry[]) => void) { FakeResizeObserver.current = this }
  observe(target: Element): void { this.targets.add(target) }
  unobserve(target: Element): void { this.targets.delete(target) }
  disconnect(): void { this.targets.clear() }
  deliver(sizes: ReadonlyMap<Element, Size>): void {
    this.callback([...sizes].filter(([target]) => this.targets.has(target)).map(([target, size]) => ({
      target,
      contentRect: size,
      contentBoxSize: [{ inlineSize: size.width }],
      borderBoxSize: [{ inlineSize: size.width }],
    })))
  }
}

const mount = (): { row: HTMLElement; leading: HTMLElement; trailing: HTMLElement; dispose: () => void } => {
  const row = document.createElement('div')
  row.style.columnGap = '8px'
  const leading = document.createElement('div')
  const trailing = document.createElement('div')
  trailing.textContent = 'Claude Opus'
  row.append(leading, trailing)
  document.body.append(row)
  return { row, leading, trailing, dispose: observeControlRow(row) }
}

const observer = (): FakeResizeObserver => {
  if (FakeResizeObserver.current === null) throw new Error('no ResizeObserver')
  return FakeResizeObserver.current
}

describe('composer control row collapse', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  it('decides from delivered sizes without reading layout', () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect')
    const { row, leading, trailing, dispose } = mount()
    observer().deliver(new Map([[row, { width: 300 }], [leading, { width: 150 }], [trailing, { width: 160 }]]))
    expect(row.hasAttribute('data-model-compact')).toBe(true)
    observer().deliver(new Map([[row, { width: 400 }]]))
    expect(row.hasAttribute('data-model-compact')).toBe(false)
    expect(rect).not.toHaveBeenCalled()
    dispose()
  })

  it('stays expanded while the expanded controls share the line', () => {
    const { row, leading, trailing, dispose } = mount()
    observer().deliver(new Map([[row, { width: 400 }], [leading, { width: 150 }], [trailing, { width: 160 }]]))
    expect(row.hasAttribute('data-model-compact')).toBe(false)
    dispose()
  })

  it('re-expands on a content change while collapsed so the next delivery measures expanded demand', async () => {
    const { row, leading, trailing, dispose } = mount()
    observer().deliver(new Map([[row, { width: 300 }], [leading, { width: 150 }], [trailing, { width: 160 }]]))
    expect(row.hasAttribute('data-model-compact')).toBe(true)
    trailing.textContent = 'Haiku'
    await Promise.resolve()
    expect(row.hasAttribute('data-model-compact')).toBe(false)
    observer().deliver(new Map([[trailing, { width: 80 }]]))
    expect(row.hasAttribute('data-model-compact')).toBe(false)
    dispose()
  })

  it('observes controls added after mount', async () => {
    const { row, dispose } = mount()
    const added = document.createElement('div')
    row.append(added)
    await Promise.resolve()
    expect(observer().targets.has(added)).toBe(true)
    dispose()
  })
})
