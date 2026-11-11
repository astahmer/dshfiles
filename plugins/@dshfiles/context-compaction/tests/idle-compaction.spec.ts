import { describe, expect, it } from 'vitest'
import { DEFAULT_IDLE_COMPACTION, IdleCompactionModel } from '../src/idle-compaction.js'

const MINUTE = 60_000
const policy = { ...DEFAULT_IDLE_COMPACTION, strategy: 'compact' as const, lifetimeMinutes: 60, leadMinutes: 5, minTokens: 100_000 }

const due = (overrides: Partial<Parameters<typeof IdleCompactionModel.due>[0]>) =>
  IdleCompactionModel.due({ now: 1_055 * MINUTE, lastActivityAt: 1_000 * MINUTE, attemptedAt: null, tokens: 200_000, policy, ...overrides })

describe('IdleCompactionModel', () => {
  it('is due only shortly before the cache lifetime ends', () => {
    const lastActivityAt = 1_000 * MINUTE
    expect(IdleCompactionModel.dueAt({ lastActivityAt, policy })).toBe(lastActivityAt + 55 * MINUTE)
    expect(due({ now: lastActivityAt + 54 * MINUTE })).toBe(false)
    expect(due({ now: lastActivityAt + 55 * MINUTE })).toBe(true)
  })

  it('never compacts after the cache lifetime expired, when the next prompt is already uncached', () => {
    const lastActivityAt = 1_000 * MINUTE
    expect(IdleCompactionModel.expiresAt({ lastActivityAt, policy })).toBe(lastActivityAt + 60 * MINUTE)
    expect(due({ now: lastActivityAt + 59 * MINUTE })).toBe(true)
    expect(due({ now: lastActivityAt + 60 * MINUTE })).toBe(false)
    expect(due({ now: lastActivityAt + 120 * MINUTE })).toBe(false)
  })

  it('stays off by default, below the token floor, and after one attempt for the same idle stretch', () => {
    expect(due({ policy: DEFAULT_IDLE_COMPACTION })).toBe(false)
    expect(due({ tokens: 99_999 })).toBe(false)
    expect(due({ tokens: null })).toBe(true)
    expect(due({ lastActivityAt: null })).toBe(false)
    expect(due({ attemptedAt: 1_000 * MINUTE })).toBe(false)
    expect(due({ attemptedAt: 1_000 * MINUTE - MINUTE })).toBe(true)
  })

  it('does nothing for a lead at or past the lifetime, which would compact a thread still in use', () => {
    const lastActivityAt = 1_000 * MINUTE
    const wrongLead = { ...policy, leadMinutes: 60 }
    expect(IdleCompactionModel.due({ now: lastActivityAt + 600 * MINUTE, lastActivityAt, attemptedAt: null, tokens: 200_000, policy: wrongLead })).toBe(false)
  })

  it('keeps the documented fallback at the Host defaults', () => {
    expect(DEFAULT_IDLE_COMPACTION).toEqual({ strategy: 'off', minTokens: 100_000, lifetimeMinutes: 5, leadMinutes: 1 })
  })
})
