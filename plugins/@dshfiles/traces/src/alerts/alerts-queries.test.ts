import { createApiClient, resourceStore } from '@dshfiles/dshx/client'
import { QueryClient } from '@dshfiles/plugin-ui/query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { tracesAlertsApi } from './alerts-api.js'
import { alertsQueries } from './alerts-queries.js'

const feedConnection = () => {
  const call = vi.fn(async () => ({ ok: true, value: { version: tracesAlertsApi.version, output: { latestEventId: 7, firing: 2, events: [] } } }))
  const service = { rpc: { call } }
  return { call, context: { get: (name: string) => (name === 'connection' ? service : undefined) } }
}

afterEach(() => resourceStore().clear())

describe('alerts feed query', () => {
  it('reads the feed through the page-wide store, so the badge and the notifier share one read', async () => {
    const connection = feedConnection()
    const panel = new QueryClient()
    const notifier = new QueryClient()
    const [badge, banner] = await Promise.all([
      panel.fetchQuery(alertsQueries.feed(createApiClient(connection.context, tracesAlertsApi, '@dshfiles/traces'), null)),
      notifier.fetchQuery(alertsQueries.feed(createApiClient(connection.context, tracesAlertsApi, '@dshfiles/traces'), null)),
    ])
    expect(badge).toEqual({ latestEventId: 7, firing: 2, events: [] })
    expect(banner).toEqual(badge)
    expect(connection.call).toHaveBeenCalledTimes(1)
  })
})
