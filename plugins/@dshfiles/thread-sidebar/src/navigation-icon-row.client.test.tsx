// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { NavigationOverflow } from './organization.js'
import { NavigationIconRow } from './navigation-icon-row.js'

const labels = {
  more: 'More sidebar destinations',
  filter: 'Filter destinations…',
  empty: 'No matching destinations',
  customize: 'Customize sidebar',
  navigation: 'Sidebar navigation',
}

const destinationLabels = ['Plugin Manager: Plugins', 'AI Accounts: Accounts', 'Jujutsu: Revision graph', 'Secret Catalog: Secrets', 'Backlog: Items']

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Element.prototype.scrollIntoView ??= () => undefined
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const renderRow = (options: { readonly overflow: NavigationOverflow; readonly rowWidth: number; readonly withSettings?: boolean }) => {
  // Two 32px icons plus the reserved More button fit in 120px of content after the row's 16px padding.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(options.rowWidth)
  const run = vi.fn()
  const onCustomize = vi.fn()
  const openSettings = vi.fn()
  render(
    <TooltipProvider>
      <NavigationIconRow
        items={destinationLabels.map(label => ({ id: label, label, icon: null, active: false, run: () => run(label) }))}
        overflow={options.overflow}
        labels={labels}
        settings={options.withSettings === true ? { label: 'Settings', open: openSettings } : null}
        onCustomize={onCustomize}
        onReorder={() => undefined}
      />
    </TooltipProvider>,
  )
  return { run, onCustomize, openSettings }
}

const rowButtonNames = (): string[] =>
  within(screen.getByRole('toolbar', { name: labels.navigation }))
    .getAllByRole('button')
    .map(button => button.getAttribute('aria-label') ?? '')

const openMenu = (): HTMLElement => {
  fireEvent.click(screen.getByRole('button', { name: labels.more }))
  return screen.getByRole('dialog')
}

const menuOptionNames = (menu: HTMLElement): string[] =>
  within(menu)
    .getAllByRole('option')
    .map(option => option.textContent ?? '')

describe('NavigationIconRow', () => {
  it('keeps the icons that fit in the row and moves the rest behind the More button', () => {
    renderRow({ overflow: 'menu', rowWidth: 136 })
    expect(rowButtonNames()).toEqual(['Plugin Manager: Plugins', 'AI Accounts: Accounts'])
    expect(menuOptionNames(openMenu())).toEqual(['Jujutsu: Revision graph', 'Secret Catalog: Secrets', 'Backlog: Items', labels.customize])
  })

  it('keeps the More button for Settings and Customize once every icon fits', () => {
    renderRow({ overflow: 'menu', rowWidth: 400, withSettings: true })
    expect(rowButtonNames()).toEqual(destinationLabels)
    expect(menuOptionNames(openMenu())).toEqual(['Settings', labels.customize])
  })

  it.each(['menu', 'scroll-menu'] as const)('offers Settings in the %s overflow More menu when the Host has settings', overflow => {
    const { openSettings } = renderRow({ overflow, rowWidth: 136, withSettings: true })
    const menu = openMenu()
    expect(menuOptionNames(menu).slice(-2)).toEqual(['Settings', labels.customize])
    fireEvent.click(within(menu).getByRole('option', { name: 'Settings' }))
    expect(openSettings).toHaveBeenCalledOnce()
  })

  it('has no More menu in the scroll overflow mode', () => {
    renderRow({ overflow: 'scroll', rowWidth: 136, withSettings: true })
    expect(screen.queryByRole('button', { name: labels.more })).toBeNull()
  })

  it('keeps every icon in the scrolling row and lists every destination in the More menu', () => {
    renderRow({ overflow: 'scroll-menu', rowWidth: 136 })
    expect(rowButtonNames()).toEqual(destinationLabels)
    expect(menuOptionNames(openMenu())).toEqual([...destinationLabels, labels.customize])
  })

  it('filters the More menu by name and opens the picked destination', () => {
    const { run } = renderRow({ overflow: 'scroll-menu', rowWidth: 136 })
    const menu = openMenu()
    fireEvent.change(within(menu).getByPlaceholderText(labels.filter), { target: { value: 'secr' } })
    expect(menuOptionNames(menu)).toEqual(['Secret Catalog: Secrets', labels.customize])
    fireEvent.click(within(menu).getByRole('option', { name: 'Secret Catalog: Secrets' }))
    expect(run).toHaveBeenCalledWith('Secret Catalog: Secrets')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
