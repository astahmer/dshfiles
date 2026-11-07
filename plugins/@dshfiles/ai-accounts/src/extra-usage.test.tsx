import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import * as Schema from 'effect/Schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { usageCardSchema } from './api.js'
import { ClaudeAccountModel } from './claude-account.js'
import { ExtraUsageModel } from './extra-usage-model.js'
import { ExtraUsageMeter } from './extra-usage-view.js'
import { claudeUsageExtraUsageOff, claudeUsageMalformedExtraUsage, claudeUsageSpendOnly, claudeUsageWithExtraUsage } from './fixtures/claude-usage.js'
import { quotaSnapshotSchema } from './usage-history-model.js'
import { UsageCardView } from './usage-card-view.js'

const noReset = (): string => 'unused'

describe('Claude extra usage', () => {
  it('reads used credits and the monthly cap from cents, with the reported utilization', () => {
    const card = ClaudeAccountModel.parseClaudeUsage(claudeUsageWithExtraUsage, 'max')
    expect(card.extraUsage).toEqual({ enabled: true, used: 12.34, monthlyLimit: 50, currency: 'USD', percentUsed: 24.68, resetsAt: null })
    expect(card.windows.map(window => window.label)).toEqual(['Current session', 'Weekly limit'])
    expect(Schema.decodeUnknownSync(usageCardSchema)(card)).toEqual(card)
  })

  it('keeps a disabled extra usage, derives utilization and normalizes currency for spend-only accounts', () => {
    expect(ClaudeAccountModel.parseClaudeUsage(claudeUsageExtraUsageOff, 'pro').extraUsage).toEqual({
      enabled: false,
      used: null,
      monthlyLimit: null,
      currency: 'USD',
      percentUsed: null,
      resetsAt: null,
    })
    const spendOnly = ClaudeAccountModel.parseClaudeUsage(claudeUsageSpendOnly, undefined)
    expect(spendOnly.windows).toEqual([])
    expect(spendOnly.extraUsage).toMatchObject({ enabled: true, used: 200, monthlyLimit: 200, currency: 'EUR', percentUsed: 100 })
  })

  it('drops an absent or malformed extra_usage without losing the plan windows', () => {
    const malformed = ClaudeAccountModel.parseClaudeUsage(claudeUsageMalformedExtraUsage, undefined)
    expect(malformed.status).toBe('ok')
    expect(malformed.windows).toHaveLength(1)
    expect('extraUsage' in malformed).toBe(false)
    expect('extraUsage' in ClaudeAccountModel.parseClaudeUsage({ five_hour: { utilization: 1 } }, undefined)).toBe(false)
    expect('extraUsage' in ClaudeAccountModel.parseClaudeUsage({ extra_usage: null }, undefined)).toBe(false)
    expect('extraUsage' in ClaudeAccountModel.parseClaudeUsage({ extra_usage: { utilization: null } }, undefined)).toBe(false)
  })

  it('summarizes spend, cap and the reported reset for the card', () => {
    const extra = { enabled: true, used: 12.34, monthlyLimit: 50, currency: 'USD', percentUsed: 24.68, resetsAt: null }
    expect(ExtraUsageModel.summarize(extra, noReset, 'en-US')).toEqual({
      label: 'Extra usage',
      amount: '$12.34 of $50.00',
      percentUsed: 24.68,
      detail: '25% of cap used · monthly, no reset date reported',
      capReached: false,
    })
    const capped = ExtraUsageModel.summarize({ ...extra, used: 50, percentUsed: 100, resetsAt: 1 }, () => 'resets in 3d', 'en-US')
    expect(capped.capReached).toBe(true)
    expect(capped.detail).toContain('Raise the cap in Claude settings')
    expect(capped.detail).toContain('resets in 3d')
    expect(ExtraUsageModel.summarize({ ...extra, monthlyLimit: null, percentUsed: null }, noReset, 'en-US')).toMatchObject({
      amount: '$12.34 spent · no cap reported',
      percentUsed: null,
    })
    expect(ExtraUsageModel.summarize({ ...extra, enabled: false, used: null, monthlyLimit: null, percentUsed: null }, noReset, 'en-US')).toMatchObject({
      label: 'Extra usage off',
      amount: null,
    })
  })

  it('renders the meter on the account card, including a spend-only account with no plan windows', () => {
    const card = ClaudeAccountModel.parseClaudeUsage(claudeUsageWithExtraUsage, 'max')
    const markup = renderToStaticMarkup(<UsageCardView now={0} onRetry={() => undefined} refreshing={false} usage={card} />)
    expect(markup).toContain('data-testid="extra-usage"')
    expect(markup).toContain('Extra usage')
    expect(markup).toContain('of cap used')
    const spendOnly = renderToStaticMarkup(
      <UsageCardView now={0} onRetry={() => undefined} refreshing={false} usage={ClaudeAccountModel.parseClaudeUsage(claudeUsageSpendOnly, undefined)} />,
    )
    expect(spendOnly).toContain('Monthly cap reached')
    expect(spendOnly).not.toContain('reported no quota windows')
    const off = renderToStaticMarkup(
      <TooltipProvider>
        <ExtraUsageMeter extra={{ enabled: false, used: null, monthlyLimit: null, currency: 'USD', percentUsed: null, resetsAt: null }} now={0} />
      </TooltipProvider>,
    )
    expect(off).toContain('Extra usage off')
    expect(off).not.toContain('role="progressbar"')
  })

  it('stores extra usage in quota history snapshots and still reads older snapshots without it', () => {
    const base = { at: 1, instanceId: 'claude-a', windows: {}, resetsAt: {}, bankedResets: 0 }
    const extraUsage = { enabled: true, used: 1, monthlyLimit: 5, currency: 'USD', percentUsed: 20, resetsAt: null }
    expect(Schema.decodeUnknownSync(quotaSnapshotSchema)({ ...base, extraUsage }).extraUsage).toEqual(extraUsage)
    expect(Schema.decodeUnknownSync(quotaSnapshotSchema)(base).extraUsage).toBeUndefined()
  })
})
