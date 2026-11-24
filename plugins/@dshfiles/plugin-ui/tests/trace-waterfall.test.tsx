import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TraceWaterfall, type TraceSpan } from '../src/components/motion/trace-waterfall.js'

const span = (id: string, start: number, end?: number, parentId?: string): TraceSpan => ({ id, name: id, kind: 'span', start, end, parentId })
const rows = [span('root', 0, 10), span('chosen', 3, 5, 'root'), span('overlap', 4, 6, 'root'), span('outside', 7, 8, 'root')]
const bar = (tree: HTMLElement, id: string) => tree.querySelector(`[data-span-id="${id}"] [data-slot="trace-waterfall-bar"]`)

beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: true, media, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('recorded waterfall zoom', () => {
  it('clips overlapping spans without hiding their rows or changing full-trace stats', () => {
    const view = render(<TraceWaterfall spans={rows} live={false} zoomable selectedId="chosen" labels={{ recorded: 'Recorded' }} />)
    expect(view.getByText('Recorded')).toBeTruthy()
    expect(view.queryByText('Done')).toBeNull()
    const tree = view.getByRole('tree')
    const button = view.getByRole('button', { name: 'Zoom to selected span' })
    const stats = view.container.querySelector('dl')?.textContent
    fireEvent.click(button)
    expect(view.container.querySelector('dl')?.textContent).toBe(stats)
    expect(view.getByRole('button', { name: 'Show full trace' })).toBe(button)
    expect(view.getByRole('status').textContent).toContain('3.0s')
    expect(bar(tree, 'root')).not.toBeNull()
    expect(bar(tree, 'overlap')?.parentElement?.style.left).toBe('50%')
    expect(bar(tree, 'outside')).toBeNull()
    expect(within(tree).getAllByRole('treeitem')).toHaveLength(4)
    fireEvent.click(button)
    expect(bar(tree, 'outside')).not.toBeNull()
  })

  it('keeps the failed status on a recorded trace with errors', () => {
    const failing = [...rows, { ...span('broken', 1, 2, 'root'), error: 'boom' }]
    const view = render(<TraceWaterfall spans={failing} live={false} zoomable selectedId="chosen" labels={{ recorded: 'Recorded' }} />)
    expect(view.getByText('Failed')).toBeTruthy()
    expect(view.queryByText('Recorded')).toBeNull()
  })

  it('keeps each zoom local and drops the effective range when its anchor disappears', () => {
    const view = render(
      <>
        <TraceWaterfall spans={rows} live={false} zoomable selectedId="chosen" />
        <TraceWaterfall spans={rows} live={false} zoomable selectedId="chosen" />
      </>,
    )
    fireEvent.click(view.getAllByRole('button', { name: 'Zoom to selected span' })[0]!)
    expect(view.getAllByRole('button', { name: 'Show full trace' })).toHaveLength(1)
    view.rerender(
      <>
        <TraceWaterfall spans={[rows[0]!]} live={false} zoomable selectedId="chosen" />
        <TraceWaterfall spans={rows} live={false} zoomable selectedId="chosen" />
      </>,
    )
    expect(view.queryByRole('button', { name: 'Show full trace' })).toBeNull()
    expect(view.getAllByRole('button', { name: 'Zoom to selected span' })[0]?.hasAttribute('disabled')).toBe(true)
    view.rerender(
      <>
        <TraceWaterfall spans={rows} live={false} zoomable selectedId="chosen" />
        <TraceWaterfall spans={rows} live={false} zoomable selectedId="chosen" />
      </>,
    )
    expect(view.queryByRole('button', { name: 'Show full trace' })).toBeNull()
  })

  it('keeps millisecond ticks and trace offsets distinct for short spans', () => {
    const view = render(<TraceWaterfall spans={[span('short', 3.012, 3.013)]} live={false} zoomable selectedId="short" />)
    fireEvent.click(view.getByRole('button', { name: 'Zoom to selected span' }))
    expect(view.getByRole('status').textContent).toContain('3012ms to 3013ms')
    expect(view.getByText('0.5ms')).toBeTruthy()
  })

  it('uses unique increasing ticks for a one-microsecond span far from trace start', () => {
    const errors = vi.spyOn(console, 'error')
    try {
      const view = render(<TraceWaterfall spans={[span('micro', 3210, 3210.000001)]} live={false} zoomable selectedId="micro" />)
      fireEvent.click(view.getByRole('button', { name: 'Zoom to selected span' }))
      const labels = ['0µs', '0.25µs', '0.5µs', '0.75µs']
      const positions = labels.map(label => Number.parseFloat(view.getByText(label, { exact: true }).style.left))
      expect(positions).toEqual([0, 25, 50, 75])
      expect(view.getByRole('status').textContent).toContain('3210000ms to 3210000.001ms')
      expect(errors.mock.calls).toEqual([])
    } finally {
      errors.mockRestore()
    }
  })

  it('thins zoom labels as the plot narrows without dropping ticks or changing the accessible range', () => {
    let width = 200
    let resize: (() => void) | undefined
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback
        }
        observe() {}
        disconnect() {}
      },
    )
    const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.slot === 'trace-waterfall-zoom-axis') return new DOMRect(220, 0, width, 32)
      if (this.parentElement?.dataset.slot === 'trace-waterfall-zoom-axis') {
        const left = 220 + (Number.parseFloat(this.style.left) * width) / 100
        return new DOMRect(left, 0, this.textContent === '0ms' ? 27 : 51, 16)
      }
      return new DOMRect()
    })
    try {
      const view = render(<TraceWaterfall spans={[span('dense', 3210, 3210.000999)]} live={false} zoomable selectedId="dense" />)
      fireEvent.click(view.getByRole('button', { name: 'Zoom to selected span' }))
      const labels = ['0ms', '0.25ms', '0.499ms', '0.749ms'].map(label => view.getByText(label).style)
      const range = view.getByRole('status').textContent
      expect(range).toContain('3210000ms to 3210000.999ms')
      expect(labels.map(style => style.visibility)).toEqual(['visible', 'hidden', 'visible', 'hidden'])
      width = 96
      act(() => resize?.())
      expect(labels.map(style => style.visibility)).toEqual(['visible', 'hidden', 'hidden', 'hidden'])
      width = 240
      act(() => resize?.())
      expect(labels.map(style => style.visibility)).toEqual(Array(4).fill('visible'))
      expect(labels.map(style => Number.parseFloat(style.left))).toEqual([0, 25, 50, 75])
      expect(view.getByRole('status').textContent).toBe(range)
    } finally {
      measure.mockRestore()
    }
  })

  it('retains annotations outside the clipped track and rejects invalid timing without losing rows', () => {
    const extra = [
      { ...span('right', 4, 8), cost: 0.25 },
      span('bad-negative', -1, 4),
      span('bad-infinite', 4, Infinity),
      span('bad-nan', NaN, 4),
      span('zero-at-start', 3, 3),
      span('zero-before-end', 4.9, 4.9),
      span('zero-at-end', 5, 5),
      span('ends-at-start', 2, 3),
      span('starts-at-end', 5, 6),
      span('open', 4),
    ]
    const view = render(<TraceWaterfall spans={[...rows, ...extra]} live={false} zoomable selectedId="chosen" />)
    const tree = view.getByRole('tree')
    const excluded = ['bad-negative', 'bad-infinite', 'bad-nan', 'open']
    for (const id of excluded) expect(bar(tree, id)).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Zoom to selected span' }))
    for (const id of [...excluded, 'zero-at-end', 'ends-at-start', 'starts-at-end']) expect(bar(tree, id)).toBeNull()
    for (const id of ['zero-at-start', 'zero-before-end']) expect(bar(tree, id)).not.toBeNull()
    const right = within(tree).getByRole('treeitem', { name: /right/ })
    const rightBar = bar(tree, 'right')
    const clip = rightBar?.closest('[data-slot="trace-waterfall-clip"]')
    expect(clip).not.toBeNull()
    const annotation = within(right).getByText('4.0s · $0.25')
    const slowest = within(right).getByText('Slowest')
    expect(clip?.contains(annotation)).toBe(false)
    expect(clip?.contains(slowest)).toBe(false)
    expect(within(tree).getAllByRole('treeitem')).toHaveLength(rows.length + extra.length)
  })

  it('does not zoom to open or invalid spans or enable zoom on a live waterfall', () => {
    const sparse = [span('open', 0), span('zero', 1, 1), span('inverted', 2, 1)]
    const view = render(<TraceWaterfall spans={sparse} live={false} zoomable selectedId="open" />)
    for (const row of sparse) {
      view.rerender(<TraceWaterfall spans={sparse} live={false} zoomable selectedId={row.id} />)
      expect(view.getByRole('button', { name: 'Zoom to selected span' }).hasAttribute('disabled')).toBe(true)
    }
    view.rerender(<TraceWaterfall spans={sparse} live zoomable selectedId="open" />)
    expect(view.queryByRole('button', { name: 'Zoom to selected span' })).toBeNull()
  })
})
