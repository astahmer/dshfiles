// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createPluginMarketPanel } from './plugin-market-page.js'
import { OPEN_SETTINGS_EVENT } from '@dshfiles/settings-shell/open-settings'

afterEach(cleanup)

const presence = (initial: boolean) => {
  let installed = initial
  const listeners = new Set<() => void>()
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    installed: () => installed,
    register: () => {
      installed = true
      for (const listener of listeners) listener()
    },
  }
}

const openRequests = (): unknown[] => {
  const requests: unknown[] = []
  const onOpen = (event: Event): void => {
    if (event instanceof CustomEvent) requests.push(event.detail)
  }
  window.addEventListener(OPEN_SETTINGS_EVENT, onOpen)
  onTestFinished(() => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen))
  return requests
}

describe('PluginMarketPanel', () => {
  it('hands over to Settings at the market section', () => {
    const requests = openRequests()
    const PluginMarketPanel = createPluginMarketPanel(presence(true))
    render(<PluginMarketPanel />)
    expect(requests).toEqual([{ section: 'market' }])
  })

  it('is one sentence and one action without the market, never a shell command, then hands over once it registers', () => {
    const requests = openRequests()
    const market = presence(false)
    const openPlugins = vi.fn()
    const PluginMarketPanel = createPluginMarketPanel({ ...market, openPlugins })
    render(<PluginMarketPanel />)
    const page = screen.getByRole('main', { name: 'Plugin market' })
    // The page body was a bare install command; the next step is a control.
    expect(page.querySelector('code')).toBeNull()
    expect(page.textContent).not.toMatch(/dsh plugin|--profile/u)
    expect(screen.getByText(/The community catalog is not installed in this profile\./u)).toBeTruthy()
    const actions = within(page).getAllByRole('button')
    expect(actions.map(button => button.textContent)).toEqual(['Open Plugins'])
    // SAFETY: the assertion above pins exactly one button, so the first one exists.
    fireEvent.click(actions[0] as HTMLElement)
    expect(openPlugins).toHaveBeenCalledOnce()
    expect(requests).toEqual([])

    act(() => market.register())
    expect(screen.queryByRole('main', { name: 'Plugin market' })).toBeNull()
    expect(requests).toEqual([{ section: 'market' }])
  })

  it('offers no action when this composition has no Plugins page', () => {
    const PluginMarketPanel = createPluginMarketPanel(presence(false))
    render(<PluginMarketPanel />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/The community catalog is not installed in this profile\./u)).toBeTruthy()
  })
})
