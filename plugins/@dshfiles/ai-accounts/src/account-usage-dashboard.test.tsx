import type { ChartView, RequestPage } from '@dshfiles/usage/api'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AccountUsageDashboardContent } from './account-usage-dashboard.js'
import { AccountUsageDashboardModel } from './account-usage-dashboard-model.js'

const emptyView = (): ChartView => ({
  appliedProvider: 'account',
  summary: {
    cost: 0,
    requests: 0,
    failed: 0,
    aborted: 0,
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    unpriced: 0,
    missingUsage: 0,
    averageDurationMs: null,
    cacheSavings: 0,
    turns: 0,
    previous: { cost: 0, requests: 0, tokens: 0, missingUsage: 0, unpriced: 0, averageDurationMs: null, cacheSavings: 0, turns: 0 },
  },
  keys: [],
  buckets: [],
  breakdown: { model: [], provider: [], project: [] },
  latency: [],
  topThreads: [],
})
const emptyRequests = (): RequestPage => ({ appliedProvider: 'account', rows: [], total: 0, statusCounts: {}, purposeCounts: {} })

describe('account usage dashboard', () => {
  it('uses equal calendar periods with the exact provider in the server query', () => {
    const now = new Date(2026, 9, 20, 15).getTime()
    for (const period of [7, 30, 90] as const) {
      const query = AccountUsageDashboardModel.accountUsageQuery('Codex-Alex', period, now)
      expect(query).toMatchObject({ provider: 'Codex-Alex', bucket: 'day', groupBy: 'model' })
      expect(query.to - query.from).toBe(period * AccountUsageDashboardModel.DAY_MS)
      expect(AccountUsageDashboardModel.accountUsageDays(query, emptyView())).toHaveLength(period)
    }
  })

  it('rejects absent or mismatched server scope confirmation, including an old Host', () => {
    const view = emptyView(),
      requests = emptyRequests()
    expect(() => AccountUsageDashboardModel.requireAccountUsageScope('account', view, requests)).not.toThrow()
    expect(() => AccountUsageDashboardModel.requireAccountUsageScope('Account', view, requests)).toThrow(/updated Usage Host/u)
    const { appliedProvider: _chartProvider, ...oldCharts } = view
    const { appliedProvider: _requestProvider, ...oldRequests } = requests
    expect(() => AccountUsageDashboardModel.requireAccountUsageScope('account', oldCharts, oldRequests)).toThrow(/No unfiltered/u)
  })

  it('shows missing cost, counts and means as unavailable, never an invented zero or p50 mean', () => {
    const view = emptyView()
    const missing = { ...view.summary, requests: 1, missingUsage: 1 }
    expect(AccountUsageDashboardModel.totalTokens(missing)).toBeNull()
    expect(AccountUsageDashboardModel.completeCost(missing)).toBeNull()
    expect(AccountUsageDashboardModel.completeCost({ ...missing, missingUsage: 0, unpriced: 1 })).toBeNull()
    expect(AccountUsageDashboardModel.usageDuration(null)).toBe('—')
    expect(AccountUsageDashboardModel.usageCost(null)).toBe('—')
    expect(AccountUsageDashboardModel.percentChange(10, 0)).toBeNull()
    expect(AccountUsageDashboardModel.percentChange(null, 10)).toBeNull()
    expect(AccountUsageDashboardModel.percentChange(120, 100)).toBe(20)
    expect(AccountUsageDashboardModel.percentChange(100, 200)).toBe(-50)
    const query = AccountUsageDashboardModel.accountUsageQuery('account', 7, new Date(2026, 9, 20, 15).getTime())
    view.buckets.push({
      start: query.from,
      key: 'model',
      cost: 0,
      requests: 1,
      failed: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      missingUsage: 1,
      unpriced: 0,
    })
    expect(AccountUsageDashboardModel.accountUsageDays(query, view)[0]).toMatchObject({ requests: 1, input: null, output: null, tokens: null, cost: null })
  })

  it('renders actual model shares, dates and request outcomes without replacing missing counts', () => {
    const view = emptyView()
    const query = AccountUsageDashboardModel.accountUsageQuery('account', 7, new Date(2026, 9, 20, 15).getTime())
    view.summary = { ...view.summary, requests: 2, input: 100, output: 20, cost: 0.25, averageDurationMs: 1_500 }
    view.breakdown.model = [{ key: 'real-model', requests: 2, tokens: 120, cost: 0.25, missingUsage: 0, unpriced: 0 }]
    view.buckets = [
      {
        start: query.from,
        key: 'real-model',
        requests: 2,
        failed: 1,
        input: 100,
        output: 20,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.25,
        missingUsage: 0,
        unpriced: 0,
      },
    ]
    const requests = emptyRequests()
    requests.rows = [
      {
        id: 'r',
        sessionId: 's',
        sessionTitle: null,
        parentSessionId: null,
        project: null,
        cwd: null,
        seq: null,
        messageId: null,
        turn: null,
        step: null,
        purpose: 'agent',
        provider: 'account',
        model: 'real-model',
        startedAt: query.from + 1_000,
        durationMs: 1_500,
        ttftMs: null,
        input: null,
        cacheRead: null,
        cacheWrite: null,
        output: null,
        cost: null,
        status: 'failed',
        stopReason: null,
        errorCode: null,
      },
    ]
    const markup = renderToStaticMarkup(
      <AccountUsageDashboardContent query={query} days={7} view={view} requests={requests} onOpenUsageHistory={() => undefined} />,
    )
    expect(markup).toContain('real-model')
    expect(markup).toContain('100%')
    expect(markup).toContain('Failed')
    expect(markup).toContain('1.5s')
    expect(markup).toContain(new Date(query.from + 1_000).toISOString())
    expect(markup).toContain('—')
    expect(() => AccountUsageDashboardModel.requireAccountUsageScope('other-account', view, requests)).toThrow()
  })

  it('renders all reference sections and truthful empty states', () => {
    const markup = renderToStaticMarkup(
      <AccountUsageDashboardContent
        query={AccountUsageDashboardModel.accountUsageQuery('account', 7, Date.now())}
        days={7}
        view={emptyView()}
        requests={emptyRequests()}
        onOpenUsageHistory={() => undefined}
      />,
    )
    for (const heading of [
      'Total requests',
      'Total tokens',
      'Estimated cost',
      'Average latency',
      'Usage over time',
      'Usage by model',
      'Usage by day',
      'Recent requests',
      'View all',
    ])
      expect(markup).toContain(heading)
    expect(markup).toContain('No model usage recorded.')
    expect(markup).toContain('No daily usage recorded.')
    expect(markup).toContain('No comparison available')
    expect(markup).toContain('not your subscription bill')
    expect(markup).toContain('—')
    expect(markup).not.toContain('title=')
    expect(markup).not.toContain('<select')
  })
})
