// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadSelectionBar } from './thread-selection-bar.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The tooltip's popper measures its trigger; jsdom has no ResizeObserver. */
class SilentResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const mount = (overrides: Partial<Parameters<typeof ThreadSelectionBar>[0]> = {}) => {
  const props = {
    count: 1,
    allPinned: false,
    allSettled: false,
    onTogglePinned: vi.fn(),
    onSettle: vi.fn(),
    onArchive: vi.fn(),
    onClear: vi.fn(),
    t: (key: string, params?: { readonly count?: number }) => (params?.count === undefined ? key : `${key}:${String(params.count)}`),
    ...overrides,
  }
  render(
    <TooltipProvider>
      <ThreadSelectionBar {...props} />
    </TooltipProvider>,
  )
  return props
}

describe('the selection bar under the thread list', () => {
  it('fits the list column: in a narrow one its three verbs keep their icons and names, without the label text', () => {
    mount()
    const bar = screen.getByRole('toolbar', { name: 'threadSidebarSelection' })
    // The bar is the container its own labels read: at the default 200px column the last button ran past the edge.
    expect(bar.className).toContain('dshx:@container/selection')
    const verbs = ['threadSidebarPin', 'threadSidebarSettle', 'threadSidebarArchive'].map(name => screen.getByRole('button', { name }))
    for (const verb of verbs) {
      expect(verb.querySelector('svg')).not.toBeNull()
      expect(verb.querySelector('[data-selection-label]')?.className).toContain('dshx:@max-[17rem]/selection:sr-only')
    }
  })

  it('runs each verb and clears the selection', () => {
    const props = mount({ allPinned: true })
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarUnpin' }))
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarSettle' }))
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarArchive' }))
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarClearSelection' }))
    expect(props.onTogglePinned).toHaveBeenCalledOnce()
    expect(props.onSettle).toHaveBeenCalledOnce()
    expect(props.onArchive).toHaveBeenCalledOnce()
    expect(props.onClear).toHaveBeenCalledOnce()
  })
  it('says how to extend the selection in the kit tooltip, not a native title', () => {
    vi.stubGlobal('ResizeObserver', SilentResizeObserver)
    mount()
    const bar = screen.getByRole('toolbar', { name: 'threadSidebarSelection' })
    expect(bar.hasAttribute('title')).toBe(false)
    fireEvent.focus(screen.getByRole('button', { name: 'threadSidebarSettle' }))
    expect(screen.getByRole('tooltip').textContent).toContain('threadSidebarSelectionHint')
  })
})
