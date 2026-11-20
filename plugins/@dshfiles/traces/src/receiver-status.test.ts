import { expect, test } from 'vitest'
import { isMoreTab } from './view-state.js'
import { ReceiverBadge } from './receiver-status.js'
import type { ReceiverStatus } from './types.js'

const counts = { traces: 0, logs: 0, metrics: 0 }
const status = (state: ReceiverStatus['state']): ReceiverStatus => ({
  mode: 'plugin',
  externalViewerUrl: null,
  state,
  address: '127.0.0.1',
  configuredPort: 4318,
  boundPort: state === 'listening' ? 4318 : null,
  message: null,
  startedAt: null,
  requests: counts,
  accepted: counts,
  rejectedRequests: 0,
  rejectedItems: 0,
  lastReceivedAt: null,
  forward: { url: null, forwarded: 0, failures: 0, lastError: null },
  store: {
    spans: 0,
    traces: 0,
    logs: 0,
    metricPoints: 0,
    oldestMs: null,
    newestMs: null,
    retentionHours: 24,
    retentionSpans: 1,
    retentionLogs: 1,
    retentionMetricPoints: 1,
  },
})
const t = (key: string): string => key

test('a healthy receiver puts no chip in the page header; a held port or a failed start does', () => {
  const badge = (state: ReceiverStatus['state']) => ReceiverBadge({ status: status(state), t })?.props as Record<string, unknown> | undefined
  for (const state of ['listening', 'starting', 'disabled'] as const) expect(badge(state)).toBeUndefined()
  expect(badge('failed')?.['data-state']).toBe('failed')
  expect(badge('port-in-use')?.['data-state']).toBe('port-in-use')
})

test('Traces, Logs and Alerts stay tabs; the five diagnostic views sit under More', () => {
  expect(['traces', 'logs', 'alerts'].filter(isMoreTab)).toEqual([])
  expect(['map', 'metrics', 'operations', 'errors', 'boards'].every(isMoreTab)).toBe(true)
})
