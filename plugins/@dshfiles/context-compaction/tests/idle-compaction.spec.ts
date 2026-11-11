import { describe, expect, it } from 'vitest'
import { DEFAULT_IDLE_COMPACTION, IdleCompactionModel } from '../src/idle-compaction.js'

const MINUTE = 60_000
const policy = { ...DEFAULT_IDLE_COMPACTION, enabled: true, lifetimeMinutes: 60, leadMinutes: 5, minTokens: 100_000 }

describe('IdleCompactionModel', () => {
  it('is due only shortly before the cache lifetime ends', () => {
    const lastActivityAt = 1_000 * MINUTE
    expect(IdleCompactionModel.dueAt({ lastActivityAt, policy })).toBe(lastActivityAt + 55 * MINUTE)
    expect(IdleCompactionModel.due({ now: lastActivityAt + 54 * MINUTE, lastActivityAt, compactedAt: null, tokens: 200_000, policy })).toBe(false)
    expect(IdleCompactionModel.due({ now: lastActivityAt + 55 * MINUTE, lastActivityAt, compactedAt: null, tokens: 200_000, policy })).toBe(true)
  })

  it('stays off by default, below the token floor, and after a compaction of the same idle stretch', () => {
    const lastActivityAt = 1_000 * MINUTE
    const now = lastActivityAt + 120 * MINUTE
    const due = (overrides: Partial<Parameters<typeof IdleCompactionModel.due>[0]>) =>
      IdleCompactionModel.due({ now, lastActivityAt, compactedAt: null, tokens: 200_000, policy, ...overrides })
    expect(due({ policy: DEFAULT_IDLE_COMPACTION })).toBe(false)
    expect(due({ tokens: 99_999 })).toBe(false)
    expect(due({ tokens: null })).toBe(true)
    expect(due({ lastActivityAt: null })).toBe(false)
    expect(due({ compactedAt: lastActivityAt })).toBe(false)
    expect(due({ compactedAt: lastActivityAt - MINUTE })).toBe(true)
  })

  it('does nothing for a lead at or past the lifetime, which would compact a thread still in use', () => {
    const lastActivityAt = 1_000 * MINUTE
    const wrongLead = { ...policy, leadMinutes: 60 }
    expect(IdleCompactionModel.due({ now: lastActivityAt + 600 * MINUTE, lastActivityAt, compactedAt: null, tokens: 200_000, policy: wrongLead })).toBe(false)
  })
})
