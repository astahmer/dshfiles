// @vitest-environment jsdom

import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PluginMarketPage } from './plugin-market-page.js'

type RenderSlot = PropsRenderSlots<'settings.section'>['renderSlot']
type SectionOwner = Parameters<RenderSlot>[1]

const owner: SectionOwner = { close: () => {} }

afterEach(cleanup)

const emptySlot: RenderSlot = () => null

const catalogSlot: RenderSlot = (name, _owner, options) =>
  name === 'settings.section' && options?.only === 'market' ? <div data-testid="catalog">dshmarket</div> : null

describe('PluginMarketPage', () => {
  it('frames the catalog section a market plugin registered', () => {
    render(<PluginMarketPage renderSlot={catalogSlot} owner={owner} installed />)
    expect(screen.getByTestId('catalog')).toBeDefined()
  })

  it('says how to install the market when no plugin registered it', () => {
    render(<PluginMarketPage renderSlot={emptySlot} owner={owner} installed={false} />)
    expect(screen.queryByTestId('catalog')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Plugin Market' })).toBeDefined()
    expect(screen.getByText('dsh plugin --profile web add dshmarket')).toBeDefined()
  })
})
