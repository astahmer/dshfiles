import { CostEstimateModel } from '@dshfiles/ai-accounts/cost-estimate'
import { describe, expect, it } from 'vitest'
import { PanelFormat } from './panel-format.ts'

describe('PanelFormat.formatUsd', () => {
  it('formats dollars with the AI Accounts rule and names a missing price', () => {
    for (const amount of [0, 0.00004, 0.0031, 0.4234, 1_234.5]) expect(PanelFormat.formatUsd(amount)).toBe(CostEstimateModel.formatUsd(amount))
    expect(PanelFormat.formatUsd(null)).toBe('unpriced')
  })
})
