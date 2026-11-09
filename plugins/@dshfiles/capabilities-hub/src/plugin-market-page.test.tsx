// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createPluginMarketPanel } from './plugin-market-page.js'

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
  window.addEventListener('dshfiles:open-settings', onOpen)
  onTestFinished(() => window.removeEventListener('dshfiles:open-settings', onOpen))
  return requests
}

describe('PluginMarketPanel', () => {
  it('hands over to Settings at the market section', () => {
    const requests = openRequests()
    const PluginMarketPanel = createPluginMarketPanel(presence(true))
    render(<PluginMarketPanel />)
    expect(requests).toEqual([{ section: 'market' }])
  })

  it('says how to install the market, then hands over once it registers', () => {
    const requests = openRequests()
    const market = presence(false)
    const PluginMarketPanel = createPluginMarketPanel(market)
    render(<PluginMarketPanel />)
    expect(screen.getByText('dsh plugin --profile web add dshmarket')).toBeDefined()
    expect(requests).toEqual([])

    act(() => market.register())
    expect(screen.queryByText('dsh plugin --profile web add dshmarket')).toBeNull()
    expect(requests).toEqual([{ section: 'market' }])
  })
})
