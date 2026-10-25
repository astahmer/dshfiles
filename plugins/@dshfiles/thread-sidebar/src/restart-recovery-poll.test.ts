import { expect, test } from 'vitest'
import { restartRecoveryRefetchInterval } from './restart-recovery-poll.js'

test('polls recovery state only while pending or before the first response', () => {
  expect(restartRecoveryRefetchInterval({ primarySurface: false, ownerMissing: false, hasData: false, hasPending: false })).toBe(false)
  expect(restartRecoveryRefetchInterval({ primarySurface: true, ownerMissing: true, hasData: false, hasPending: false })).toBe(false)
  expect(restartRecoveryRefetchInterval({ primarySurface: true, ownerMissing: false, hasData: true, hasPending: false })).toBe(false)
  expect(restartRecoveryRefetchInterval({ primarySurface: true, ownerMissing: false, hasData: true, hasPending: true })).toBe(30_000)
  expect(restartRecoveryRefetchInterval({ primarySurface: true, ownerMissing: false, hasData: false, hasPending: false })).toBe(30_000)
})
