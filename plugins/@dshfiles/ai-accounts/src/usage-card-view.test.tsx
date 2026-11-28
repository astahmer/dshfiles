import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import * as Schema from 'effect/Schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { usageCardSchema } from './api.js'
import { ExtraUsageModel } from './extra-usage-model.js'
import { UsageOverviewModel } from './usage-overview-model.js'
import { quotaWindowCategories, UsageCardView } from './usage-card-view.js'

const now = Date.parse('2026-11-27T12:00:00Z')
const resetsAt = Date.parse('2026-12-01T00:00:00Z')
const money = (amount: number): string => ExtraUsageModel.formatMoney(amount, 'EUR')
const reset = UsageOverviewModel.formatResetIn(resetsAt, now)

describe('quota window captions', () => {
  it('shows a window own credit beside the percent and its reset', () => {
    const [category] = quotaWindowCategories({
      windows: [{ label: 'API credit', percentRemaining: 15.6, resetsAt, amount: { used: 21.53, limit: 25.5, currency: 'EUR' } }],
      now,
      history: [],
    })
    expect(category?.caption).toBe(`${money(21.53)} of ${money(25.5)} · ${reset}`)
    // The percent rolls on its own and "left" is the card's unit word beside it, never glued into one string.
    expect(category?.formatTotal?.(15.6)).toBe('16%')
    expect(category?.unit).toBe('left')
  })

  it('keeps the reset alone for a window that reports only a percentage', () => {
    const [category] = quotaWindowCategories({
      windows: [{ label: 'Vibe & Studio allowance', percentRemaining: 100, resetsAt }],
      now,
      history: [],
    })
    expect(category?.caption).toBe(reset)
  })

  it('carries a window amount over the wire and leaves it off a percent-only window', () => {
    const card = Schema.decodeUnknownSync(usageCardSchema)({
      status: 'ok',
      message: null,
      identity: null,
      plan: 'INDIVIDUAL',
      windows: [
        { label: 'API credit', percentRemaining: 15.6, resetsAt, amount: { used: 21.53, limit: 25.5, currency: 'EUR' } },
        { label: 'Vibe & Studio allowance', percentRemaining: 100, resetsAt },
      ],
      bankedResets: 0,
      bankedResetExpiries: [],
    })
    expect(card.windows[0]?.amount).toEqual({ used: 21.53, limit: 25.5, currency: 'EUR' })
    expect(card.windows[1]?.amount).toBeUndefined()
  })

  it('renders both Mistral windows with their money, never a lone full allowance', () => {
    const usage = Schema.decodeUnknownSync(usageCardSchema)({
      status: 'ok',
      message: null,
      identity: null,
      plan: 'INDIVIDUAL',
      windows: [
        { label: 'API credit', percentRemaining: 15.6, resetsAt, amount: { used: 21.53, limit: 25.5, currency: 'EUR' } },
        { label: 'Vibe & Studio allowance', percentRemaining: 100, resetsAt, amount: { used: 0, limit: 255, currency: 'EUR' } },
      ],
      bankedResets: 0,
      bankedResetExpiries: [],
    })
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <UsageCardView now={now} refreshing={false} usage={usage} onRetry={() => undefined} />
      </TooltipProvider>,
    )
    expect(markup).toContain('API credit')
    expect(markup).toContain('Vibe &amp; Studio allowance')
    expect(markup).toContain(`${money(21.53)} of ${money(25.5)}`)
    expect(markup).toContain(`${money(0)} of ${money(255)}`)
    expect(markup).toContain('aria-label="API credit: 16% left"')
    expect(markup).toMatch(/<span class="[^"]*">left<\/span>/)
  })
})
