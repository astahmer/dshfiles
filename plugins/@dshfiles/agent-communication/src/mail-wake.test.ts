import { describe, expect, it } from 'vitest'
import { MailWakeModel, type WakeFacts } from './mail-wake.js'

const now = 1_800_000_000_000
const cooldownMs = 5 * 60_000

const facts = (overrides: Partial<WakeFacts> = {}): WakeFacts => ({
  recipientId: 'session-b',
  senderId: 'session-a',
  senderLabel: 'Add login page',
  messageId: '11111111-1111-4111-8111-111111111111',
  intent: 'request',
  ...overrides,
})

const state = (overrides: Partial<Parameters<typeof MailWakeModel.shouldWake>[0]['state']> = {}) => ({
  lastByRecipient: new Map<string, number>(),
  lastByPair: new Map<string, number>(),
  wakesByRecipient: new Map<string, readonly number[]>(),
  ...overrides,
})

const decide = (input: { facts?: WakeFacts; enabled?: boolean; state?: ReturnType<typeof state>; at?: number; perHour?: number } = {}) =>
  MailWakeModel.shouldWake({
    facts: input.facts ?? facts(),
    now: input.at ?? now,
    enabled: input.enabled ?? true,
    cooldownMs,
    perHour: input.perHour ?? 12,
    state: input.state ?? state(),
  })

describe('peer request wake', () => {
  it('wakes only a request, never a notice, a disabled setting or itself', () => {
    expect(decide()).toBe(true)
    expect(decide({ facts: facts({ intent: 'notice' }) })).toBe(false)
    expect(decide({ enabled: false })).toBe(false)
    expect(decide({ facts: facts({ senderId: 'session-b' }) })).toBe(false)
  })

  it('coalesces a burst into one wake and damps a reply loop between the same two Agents', () => {
    const woken = MailWakeModel.recordWake({ facts: facts(), now, state: state() })
    expect(decide({ state: woken })).toBe(false)
    expect(decide({ state: woken, at: now + cooldownMs })).toBe(true)
    // B answering A's woken turn with its own request must not bounce straight back.
    const replied = MailWakeModel.recordWake({ facts: facts({ senderId: 'session-b', recipientId: 'session-a' }), now: now + 1, state: woken })
    expect(decide({ facts: facts({ senderId: 'session-b', recipientId: 'session-a' }), state: replied, at: now + 60_000 })).toBe(false)
    expect(decide({ facts: facts({ senderId: 'session-b', recipientId: 'session-a' }), state: replied, at: now + cooldownMs + 1 })).toBe(true)
  })

  it('caps wakes per recipient per hour', () => {
    const many = new Map([['session-b', [now - 59 * 60_000, now - 58 * 60_000]]])
    expect(decide({ state: state({ wakesByRecipient: many }), perHour: 2 })).toBe(false)
    expect(decide({ state: state({ wakesByRecipient: many }), perHour: 3 })).toBe(true)
    // An old wake ages out of the window.
    expect(decide({ state: state({ wakesByRecipient: new Map([['session-b', [now - 61 * 60_000]]]) }), perHour: 1 })).toBe(true)
  })

  it('wakes with a pointer to the message, not the peer text', () => {
    const text = MailWakeModel.wakeText({ messageId: facts().messageId, senderLabel: facts().senderLabel })
    expect(text).toContain('Add login page')
    expect(text).toContain(facts().messageId)
    expect(text).toContain('dshx_comm_inbox')
    expect(text).toContain('untrusted')
  })
})
