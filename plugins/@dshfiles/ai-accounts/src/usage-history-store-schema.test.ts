import { describe, expect, it } from 'vitest'
import { usageHistoryDomain } from './usage-history.js'

const meta = usageHistoryDomain.global.schema
const quota = usageHistoryDomain.tables.quota.valueSchema

const snapshot = {
  at: 1,
  instanceId: 'codex-primary',
  windows: { session: 12 },
  resetsAt: { session: 60_000 },
  bankedResets: 2,
}

describe('usage history storage schema', () => {
  it('fills the defaults a stored global may omit', () => {
    expect(meta.parse({})).toEqual({ lastReadAt: null, lastAttemptAt: null, intervalMinutes: 5, retentionDays: 30 })
  })

  it('rejects a stored global outside the allowed interval or retention', () => {
    expect(meta.safeParse({ intervalMinutes: 0 }).success).toBe(false)
    expect(meta.safeParse({ retentionDays: 366 }).success).toBe(false)
  })

  it('strips properties a stored global does not declare', () => {
    expect(meta.parse({ intervalMinutes: 15, lastSweep: 3 })).toEqual({
      lastReadAt: null,
      lastAttemptAt: null,
      intervalMinutes: 15,
      retentionDays: 30,
    })
  })

  it('rejects a quota snapshot whose banked reset count is out of range', () => {
    expect(quota.safeParse(snapshot).success).toBe(true)
    expect(quota.safeParse({ ...snapshot, bankedResets: 21 }).success).toBe(false)
    expect(quota.safeParse({ ...snapshot, instanceId: '' }).success).toBe(false)
  })

  it('accepts an older snapshot without the fields added later', () => {
    expect(quota.safeParse({ ...snapshot, bankedResetExpiries: undefined }).success).toBe(true)
  })
})
