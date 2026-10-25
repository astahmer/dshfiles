import { expect, test } from 'vitest'
import { runtimeStatusRefreshRefetchInterval } from './runtime-status-refresh-policy.js'

test('polls a pending remote refresh without overriding disabled status queries', () => {
  expect(runtimeStatusRefreshRefetchInterval({ intervalMs: 30_000, refreshing: false })).toBe(30_000)
  expect(runtimeStatusRefreshRefetchInterval({ intervalMs: 30_000, refreshing: true })).toBe(5_000)
  expect(runtimeStatusRefreshRefetchInterval({ intervalMs: false, refreshing: true })).toBe(false)
})
