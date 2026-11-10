// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import type { SessionUsageCostOwnerProps, SessionUsageCostPlacement } from '@dshfiles/chat/session-usage-cost'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SESSION_COST_PROJECTION_KEY } from './cost-estimate.js'
import { SessionCostDockEntry, SessionUsageCost } from './session-cost.js'

const state = vi.hoisted(() => ({ settings: { costEstimates: true, costPlacement: 'inside' } }))
const api = vi.hoisted(() => ({
  quoteRoutes: vi.fn(async () => ({
    fetchedAt: null,
    quotes: [
      { provider: 'openai', model: 'luna', modelsDevId: 'openai/luna', match: 'exact' as const, free: false, price: { input: 1, output: 10, cacheRead: 0.1 } },
    ],
  })),
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ relativeTime: () => 'now' }))
vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@dshfiles/dshx/client')>()),
  useApi: () => api,
  useSettings: () => ({ value: state.settings }),
}))

const view = {
  groups: [
    {
      provider: 'openai',
      model: 'luna',
      band: 0,
      requests: 2,
      tokens: { uncachedInputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 },
    },
  ],
  turn: null,
}
// SAFETY: the fixture answers only the cost projection key, which is what the estimate reads.
const useProjection = ((key: string) => (key === SESSION_COST_PROJECTION_KEY ? view : undefined)) as SessionUsageCostOwnerProps['useProjection']

const roots: Root[] = []
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})

const renderCost = async (placement: SessionUsageCostPlacement) => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <PluginQueryProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <span data-seat="">
          <SessionUsageCost placement={placement} useProjection={useProjection} />
        </span>
        <SessionCostDockEntry useProjection={useProjection} />
      </PluginQueryProvider>,
    )
  })
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  return {
    seat: container.querySelector('[data-seat]')?.textContent ?? null,
    separate: container.querySelector('button[aria-label^="Estimated thread cost"]'),
  }
}

describe('SessionUsageCost', () => {
  it('adds the estimate after the usage pill label and beside a bucket', async () => {
    state.settings = { costEstimates: true, costPlacement: 'inside' }
    expect((await renderCost('pill')).seat).toMatch(/^ · .*\$\d/)
    const output = await renderCost('output')
    expect(output.seat).toBe('$1.00')
    expect(output.separate).toBeNull()
  })

  it('leaves the usage pill to the separate dock entry when placement is separate', async () => {
    state.settings = { costEstimates: true, costPlacement: 'separate' }
    const separate = await renderCost('pill')
    expect(separate.seat).toBe('')
    expect(separate.separate).not.toBeNull()
  })

  it('adds nothing while cost estimates are off', async () => {
    state.settings = { costEstimates: false, costPlacement: 'inside' }
    expect((await renderCost('pill')).seat).toBe('')
  })
})
