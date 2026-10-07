import { describe, expect, it } from 'vitest'
import { usageCardSchema, type UsageCard } from './api.js'
import { knownQuotaResetAt } from './quota-reset.js'

const usage = (patch: Partial<UsageCard> = {}): UsageCard =>
  usageCardSchema.parse({
    status: 'ok',
    message: null,
    identity: null,
    plan: null,
    windows: [],
    bankedResets: 0,
    bankedResetExpiries: [],
    ...patch,
  })

describe('knownQuotaResetAt', () => {
  it('uses the latest reset among exhausted account-correlated windows', () => {
    expect(
      knownQuotaResetAt(
        usage({
          windows: [
            { label: 'short', percentRemaining: 0, resetsAt: 2_000 },
            { label: 'long', percentRemaining: 0, resetsAt: 3_000 },
            { label: 'available', percentRemaining: 20, resetsAt: null },
          ],
        }),
        1_000,
      ),
    ).toBe(3_000)
  })

  it('does not invent a reset when any exhausted window has no future reset', () => {
    expect(
      knownQuotaResetAt(
        usage({
          windows: [
            { label: 'short', percentRemaining: 0, resetsAt: 2_000 },
            { label: 'long', percentRemaining: 0, resetsAt: null },
          ],
        }),
        1_000,
      ),
    ).toBeNull()
    expect(knownQuotaResetAt(usage({ windows: [{ label: 'short', percentRemaining: 0, resetsAt: 1_000 }] }), 1_000)).toBeNull()
  })

  it('keeps non-exhausted and non-successful readings manual', () => {
    expect(knownQuotaResetAt(usage({ windows: [{ label: 'short', percentRemaining: 35, resetsAt: 4_000 }] }), 1_000)).toBeNull()
    expect(knownQuotaResetAt(usage({ status: 'rate-limited', windows: [{ label: 'short', percentRemaining: 0, resetsAt: 4_000 }] }), 1_000)).toBeNull()
  })
})
