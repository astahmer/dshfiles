import { expect, test } from 'vitest'
import { runtimePingRefetchInterval, runtimeStatusRefreshRefetchInterval } from './runtime-status-refresh-policy.js'

test('polls a pending remote refresh without overriding disabled status queries', () => {
  expect(runtimeStatusRefreshRefetchInterval({ intervalMs: 30_000, refreshing: false, available: undefined })).toBe(30_000)
  expect(runtimeStatusRefreshRefetchInterval({ intervalMs: 30_000, refreshing: true, available: undefined })).toBe(5_000)
  expect(runtimeStatusRefreshRefetchInterval({ intervalMs: false, refreshing: true, available: undefined })).toBe(false)
  expect(runtimeStatusRefreshRefetchInterval({ intervalMs: 30_000, refreshing: false, available: true })).toBe(30_000)
})

test('backs an unavailable runtime off to at least a minute instead of refreshing every few seconds', () => {
  expect(runtimeStatusRefreshRefetchInterval({ intervalMs: 5_000, refreshing: true, available: false })).toBe(60_000)
  expect(runtimeStatusRefreshRefetchInterval({ intervalMs: 30_000, refreshing: false, available: false })).toBe(60_000)
  expect(runtimeStatusRefreshRefetchInterval({ intervalMs: 120_000, refreshing: false, available: false })).toBe(120_000)
  expect(runtimeStatusRefreshRefetchInterval({ intervalMs: false, refreshing: false, available: false })).toBe(false)
})

test('pings an unavailable runtime once a minute even with the menu open', () => {
  expect(runtimePingRefetchInterval({ menuOpen: true, available: undefined })).toBe(10_000)
  expect(runtimePingRefetchInterval({ menuOpen: true, available: true })).toBe(10_000)
  expect(runtimePingRefetchInterval({ menuOpen: false, available: true })).toBe(60_000)
  expect(runtimePingRefetchInterval({ menuOpen: true, available: false })).toBe(60_000)
  expect(runtimePingRefetchInterval({ menuOpen: false, available: false })).toBe(60_000)
})
