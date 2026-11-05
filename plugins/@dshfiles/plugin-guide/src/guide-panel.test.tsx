// @vitest-environment jsdom

import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GUIDE_CATALOG } from './generated/guide-catalog.js'

const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  writeClipboard: vi.fn(async () => true),
}))

vi.mock('@dshfiles/dshx/client', () => ({ useApi: () => ({ catalog: mocks.catalog }) }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ writeClipboard: mocks.writeClipboard }))

const { PluginGuidePanel } = await import('./guide-panel.js')

afterEach(cleanup)

const renderPanel = (stale = false) => {
  mocks.catalog.mockResolvedValue({
    freshness: {
      catalogDshVersion: GUIDE_CATALOG.dshVersion,
      runtimeDshVersion: GUIDE_CATALOG.dshVersion,
      stale,
      reasons: stale ? ['Native slot facts were last checked against DSH 0.2.0-rc.2.'] : [],
    },
    catalog: GUIDE_CATALOG,
  })
  const draftForAgent = vi.fn()
  render(
    <PluginQueryProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PluginGuidePanel draftForAgent={draftForAgent} />
    </PluginQueryProvider>,
  )
  return { draftForAgent }
}

describe('PluginGuidePanel', () => {
  it('filters by kind and search, shows the replacement risk, and drafts without sending', async () => {
    const { draftForAgent } = renderPanel()
    expect(await screen.findByText(`Static catalog · DSH ${GUIDE_CATALOG.dshVersion}`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Native slots/u }))
    const list = screen.getByRole('list', { name: 'Extension surfaces' })
    fireEvent.click(within(list).getByRole('button', { name: /^sidebar Shell-owned/u }))
    const detail = screen.getByRole('region', { name: 'sidebar details' })
    expect(within(detail).getByText('Shell-owned · high risk')).toBeTruthy()
    expect(within(detail).getByText(/not live/u)).toBeTruthy()
    fireEvent.click(within(detail).getByRole('button', { name: 'Draft for agent' }))
    expect(draftForAgent).toHaveBeenCalledTimes(1)
    expect(draftForAgent.mock.calls[0]?.[0]).toContain('Plugin Guide · Native slots · sidebar')

    fireEvent.change(screen.getByRole('textbox', { name: 'Search extension surfaces' }), { target: { value: 'zz-no-such-surface' } })
    expect(await screen.findByText('Nothing matches. Clear the search or pick All.')).toBeTruthy()
  })

  it('says when the catalog may be stale', async () => {
    renderPanel(true)
    expect(await screen.findByText('Parts of this catalog may be out of date')).toBeTruthy()
    expect(screen.getByText('Native slot facts were last checked against DSH 0.2.0-rc.2.')).toBeTruthy()
  })
})
