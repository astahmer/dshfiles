import { expect, test } from 'vitest'
import { usageLimitRefetchInterval } from './usage-limit-poll.js'

const healthy = { primarySurface: true, ownerMissing: false, errored: false, eventsLive: true, waiting: false }

test('stops quota continuation polling after the API fails', () => {
  expect(usageLimitRefetchInterval({ ...healthy, waiting: true, errored: true })).toBe(false)
  expect(usageLimitRefetchInterval({ ...healthy, waiting: true, ownerMissing: true })).toBe(false)
  expect(usageLimitRefetchInterval({ ...healthy, waiting: true, primarySurface: false })).toBe(false)
})

test('reads quota continuations on change events instead of polling while none waits', () => {
  expect(usageLimitRefetchInterval(healthy)).toBe(false)
  expect(usageLimitRefetchInterval({ ...healthy, waiting: true })).toBe(15_000)
  expect(usageLimitRefetchInterval({ ...healthy, eventsLive: false })).toBe(15_000)
})
