import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FallbackChain } from '../src/components/motion/fallback-chain.js'

afterEach(() => vi.unstubAllGlobals())

describe('FallbackChain', () => {
  it('formats dollars with the formatter its host screen passes', () => {
    vi.stubGlobal('matchMedia', (query: string): Pick<MediaQueryList, 'matches' | 'media' | 'addEventListener' | 'removeEventListener'> => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    const view = render(
      <FallbackChain
        heading="Fallback chain"
        route="auto"
        attempts={[{ id: 'a', model: 'Model A', provider: 'Provider', status: 'answered', cost: 1234.5, elapsedMs: 900, timeoutMs: 30_000 }]}
        formatCost={usd => `USD ${usd.toFixed(1)}`}
      />,
    )

    expect(view.container.textContent).toContain('USD 1234.5')
    expect(view.container.textContent).not.toContain('$1234.50')
  })
})
