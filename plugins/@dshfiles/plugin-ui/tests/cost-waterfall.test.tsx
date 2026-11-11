import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CostWaterfall } from '../src/components/motion/cost-waterfall.js'

afterEach(() => vi.unstubAllGlobals())

describe('CostWaterfall', () => {
  it('formats dollars with the formatter its host screen passes', () => {
    vi.stubGlobal('matchMedia', (query: string): Pick<MediaQueryList, 'matches' | 'media' | 'addEventListener' | 'removeEventListener'> => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    const view = render(
      <CostWaterfall steps={[{ id: 'turn-1', name: 'Turn 1', start: 0, end: 1, cost: 1234.5 }]} live={false} formatCost={usd => `USD ${usd.toFixed(1)}`} />,
    )

    expect(view.container.textContent).toContain('USD 1234.5')
    expect(view.container.textContent).not.toContain('$1234.50')
  })
})
