// @vitest-environment jsdom
import { Popover, PopoverAnchor, PopoverContent } from '@dshfiles/plugin-ui/components/ui/popover'
import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComposerBarPlacement, ComposerMoreItem } from './composer-more.ts'

const registry = vi.hoisted(() => {
  const items: ComposerMoreItem[] = []
  return { items }
})
vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@dshfiles/dshx/client')>()),
  useRegistry: () => registry.items,
}))

const { ComposerMoreMenu } = await import('./composer-more-menu.tsx')

const placement = (pinned: boolean): ComposerBarPlacement & { set: (next: boolean) => void } => {
  let value = pinned
  const listeners = new Set<() => void>()
  return {
    pinned: () => value,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: next => {
      value = next
      for (const listener of listeners) listener()
    },
  }
}

const roots: Root[] = []
const render = async (element: JSX.Element): Promise<HTMLDivElement> => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(element))
  return container
}
const openMenu = async (container: HTMLElement): Promise<void> => {
  const trigger = container.querySelector<HTMLButtonElement>('[data-composer-more]')
  if (trigger === null) throw new Error('missing More button')
  await act(async () => {
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
  const select = vi.fn()
  registry.items = [
    { id: 'undo', group: 'history', order: 10, label: 'Undo last turn', available: sessionId => sessionId === 's1', select },
    { id: 'saved', group: 'prompts', order: 20, label: 'Saved prompts…', keys: ['/prompts'], select },
  ]
})
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('composer More menu', () => {
  it('lists every row with its keys, grouped, and disables what this thread cannot do', async () => {
    const container = await render(<ComposerMoreMenu placement={placement(false)} sessionId="s2" />)
    expect(container.querySelector('[data-composer-more]')?.getAttribute('aria-label')).toBe('More composer actions')
    await openMenu(container)
    const rows = [...document.querySelectorAll('[data-composer-more-item]')]
    expect(rows.map(row => row.textContent)).toEqual(['Undo last turn', 'Saved prompts…/prompts'])
    expect(rows[0]?.getAttribute('data-disabled')).toBe('')
    expect(document.querySelectorAll('[role="separator"]')).toHaveLength(1)
  })

  it('hides while the user pins the controls back into the bar, and returns when unpinned', async () => {
    const bar = placement(true)
    const container = await render(<ComposerMoreMenu placement={bar} sessionId="s1" />)
    expect(container.querySelector('[data-composer-more]')).toBeNull()
    await act(async () => bar.set(false))
    expect(container.querySelector('[data-composer-more]')).not.toBeNull()
  })

  it('selects a row for this composer once the menu has closed', async () => {
    vi.useFakeTimers()
    const container = await render(<ComposerMoreMenu placement={placement(false)} sessionId="s1" />)
    await openMenu(container)
    const undo = document.querySelector<HTMLElement>('[data-composer-more-item="undo"]')
    await act(async () => {
      undo?.click()
    })
    expect(registry.items[0]?.select).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(registry.items[0]?.select).toHaveBeenCalledWith('s1')
    vi.useRealTimers()
  })

  // b:2cep: the menu animates out before it unmounts. A row that opened its popover during that animation lost focus
  // to the menu's focus trap, and the popover closed itself as "focus outside" a moment after it appeared.
  it("opens a row's popover only after the menu has animated out, and the popover stays open", async () => {
    const realStyle = window.getComputedStyle.bind(window)
    // jsdom runs no CSS: give the menu content the kit's exit animation so Radix keeps it mounted until animationend.
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = realStyle(element, pseudo)
      if (!(element instanceof HTMLElement) || element.getAttribute('data-slot') !== 'dropdown-menu-content') return style
      Object.defineProperty(style, 'animationName', { configurable: true, get: () => (element.getAttribute('data-state') === 'closed' ? 'exit' : 'enter') })
      return style
    })
    if (typeof globalThis.CSS?.escape !== 'function') vi.stubGlobal('CSS', { escape: (value: string) => value })
    const opened = { open: (): void => undefined }
    registry.items = [{ id: 'saved', group: 'prompts', order: 20, label: 'Saved prompts…', select: () => opened.open() }]
    const RowPopover = () => {
      const [open, setOpen] = useState(false)
      useEffect(() => {
        opened.open = () => setOpen(true)
      }, [])
      return (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverAnchor asChild>
            <span />
          </PopoverAnchor>
          <PopoverContent>
            <input aria-label="Search saved prompts" />
          </PopoverContent>
        </Popover>
      )
    }
    const container = await render(
      <>
        <ComposerMoreMenu placement={placement(false)} sessionId="s1" />
        <RowPopover />
      </>,
    )
    await openMenu(container)
    const content = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]')
    await act(async () => {
      document.querySelector<HTMLElement>('[data-composer-more-item="saved"]')?.click()
      await new Promise(resolve => setTimeout(resolve, 20))
    })
    // Still animating out: the row has not run yet.
    expect(content?.isConnected).toBe(true)
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
    await act(async () => {
      content?.dispatchEvent(Object.assign(new Event('animationend', { bubbles: true }), { animationName: 'exit' }))
    })
    // The menu unmounts; Radix then fires onCloseAutoFocus on a timer, which runs the picked row.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })
    expect(document.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull()
    expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull()
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })
    expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull()
  })
})
