import { describe, expect, it } from 'vitest'
import { usageCardSchema, type UsageCard } from './api.js'
import { knownQuotaResetAt, resetAtFromMessage } from './quota-reset.js'

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

describe('resetAtFromMessage', () => {
  const now = Date.UTC(2026, 9, 22, 10, 0, 0)

  it('reads the wall-clock reset a provider message names in its own zone', () => {
    expect(resetAtFromMessage("You've hit your individual spend limit · your session limit resets 3pm (Europe/Paris)", now)).toBe(
      Date.UTC(2026, 9, 22, 13, 0, 0),
    )
  })

  it('reads a relative wait as a reset ahead of now', () => {
    expect(resetAtFromMessage('You have hit your ChatGPT usage limit (plus plan). Try again in ~151 min.', now)).toBe(now + 151 * 60_000)
    expect(resetAtFromMessage('Retry after 2 hours.', now)).toBe(now + 2 * 60 * 60_000)
  })

  it('rolls a named clock time that already passed to the next day', () => {
    expect(resetAtFromMessage('Your limit resets 9am (Europe/Paris)', now)).toBe(Date.UTC(2026, 9, 23, 7, 0, 0))
  })

  it('leaves wording without a usable reset alone', () => {
    expect(resetAtFromMessage('unsupported parameter', now)).toBeNull()
    expect(resetAtFromMessage('Your limit resets 3pm (Mars/Olympus)', now)).toBeNull()
    expect(resetAtFromMessage('Try again in 400 hours', now)).toBeNull()
    expect(resetAtFromMessage('resets 3pm', -1)).toBeNull()
  })
})
