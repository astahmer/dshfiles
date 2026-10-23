import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { JevUsageCard } from './jev-usage-card.js'
import type { JevUsageView } from './api.js'

const usage: JevUsageView = {
  calls: 3,
  succeeded: 2,
  failed: 1,
  inputTokens: 150_000,
  outputTokens: 40,
  callsWithoutInputUsage: 1,
  estimatedCostUsd: 0.0063,
  byCredential: [
    {
      credential: 'secret:BACKLOG_JEV',
      backlogCalls: 2,
      memoryCalls: 0,
      calls: 2,
      succeeded: 1,
      failed: 1,
      inputTokens: 50_000,
      outputTokens: 10,
      callsWithoutInputUsage: 1,
      estimatedCostUsd: 0.0021,
    },
    {
      credential: 'secret:MEMORY_JEV',
      backlogCalls: 0,
      memoryCalls: 1,
      calls: 1,
      succeeded: 1,
      failed: 0,
      inputTokens: 100_000,
      outputTokens: 30,
      callsWithoutInputUsage: 0,
      estimatedCostUsd: 0.0042,
    },
  ],
}

describe('JevUsageCard', () => {
  it('renders the DSH-only estimate and source counts', () => {
    const html = renderToStaticMarkup(<JevUsageCard usage={usage} error={undefined} failed={false} />)

    expect(html).toContain('Jev API usage')
    expect(html).toContain('DSH-local estimated usage · $0.042 per 1M input tokens · output free. Not provider account balance.')
    expect(html).toContain('150K')
    expect(html).toContain('$0.0063')
    expect(html).toContain('secret:BACKLOG_JEV')
    expect(html).toContain('Backlog 2 / Memory 0')
    expect(html).toContain('secret:MEMORY_JEV')
    expect(html).toContain('Backlog 0 / Memory 1')
    expect(html).toContain('Jev calls this month')
    expect(html).toContain('Estimated cost this month')
    expect(html).toContain('Input tokens this month')
    expect(html).toContain('Usage by API key · calendar month to date')
    expect(html).toContain('$0.0021 · 2 requests')
    expect(html).toContain('$0.0042 · 1 request')
    expect(html).toContain('secret:BACKLOG_JEV share of input tokens this month')
    expect(html).toContain('1 calls missing input-token data')
    expect(html).toContain('Not provider account balance.')
    expect(html).toContain('Credential labels are local references, not provider-verified billing identity.')
    expect(html).not.toContain('synthetic-secret-value')
  })

  it('shows an unknown historical credential bucket and keeps malformed usage hidden from the label schema', () => {
    const legacy: JevUsageView = {
      ...usage,
      byCredential: [
        {
          credential: 'Legacy / unknown',
          backlogCalls: 0,
          memoryCalls: 0,
          calls: 3,
          succeeded: 2,
          failed: 1,
          inputTokens: 150_000,
          outputTokens: 40,
          callsWithoutInputUsage: 1,
          estimatedCostUsd: 0.0063,
        },
      ],
    }
    const html = renderToStaticMarkup(<JevUsageCard usage={legacy} error={undefined} failed={false} />)
    expect(html).toContain('Legacy / unknown')
  })

  it('renders the collapsed other-credentials bucket', () => {
    const collapsed: JevUsageView = {
      ...usage,
      byCredential: [
        {
          credential: 'Other credentials',
          backlogCalls: 2,
          memoryCalls: 1,
          calls: 3,
          succeeded: 2,
          failed: 1,
          inputTokens: 150_000,
          outputTokens: 40,
          callsWithoutInputUsage: 1,
          estimatedCostUsd: 0.0063,
        },
      ],
    }
    const html = renderToStaticMarkup(<JevUsageCard usage={collapsed} error={undefined} failed={false} />)
    expect(html).toContain('Other credentials')
  })

  it('uses a safe error state', () => {
    const html = renderToStaticMarkup(<JevUsageCard usage={undefined} error={new Error('request unavailable')} failed />)

    expect(html).toContain('request unavailable')
    expect(html).not.toContain('apiKey')
  })
})
