import { expect, test } from 'vitest'
import { usageLimitRefetchInterval } from './usage-limit-poll.js'

test('stops quota continuation polling after the API fails', () => {
  expect(usageLimitRefetchInterval({ primarySurface: true, ownerMissing: false, errored: true })).toBe(false)
  expect(usageLimitRefetchInterval({ primarySurface: true, ownerMissing: true, errored: false })).toBe(false)
  expect(usageLimitRefetchInterval({ primarySurface: false, ownerMissing: false, errored: false })).toBe(false)
  expect(usageLimitRefetchInterval({ primarySurface: true, ownerMissing: false, errored: false })).toBe(15_000)
})
