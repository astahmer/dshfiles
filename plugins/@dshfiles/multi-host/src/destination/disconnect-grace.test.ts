import { describe, expect, test } from 'vitest'
import { DisconnectGrace, graceDisplay, graceTransition, type GracePhase } from './disconnect-grace.js'

const FAILED_STATE = { tone: 'error' as const, label: 'Runtime unreachable' }

describe('disconnect grace', () => {
  test('a host that was online moments ago still has time before it reads as failed', () => {
    expect(DisconnectGrace.remaining({ lastOnlineAt: 1_000, now: 4_000 })).toBe(DisconnectGrace.windowMs - 3_000)
  })

  test('the window closes and never goes negative', () => {
    expect(DisconnectGrace.remaining({ lastOnlineAt: 1_000, now: 1_000 + DisconnectGrace.windowMs })).toBe(0)
    expect(DisconnectGrace.remaining({ lastOnlineAt: 1_000, now: 1_000_000 })).toBe(0)
  })

  test('an online observation opens a window that keeps its place', () => {
    const grace = graceTransition({ phase: 'unseen' }, { kind: 'online', at: 1_000 })
    expect(grace).toEqual({ phase: 'grace', lastOnlineAt: 1_000 })
    expect(graceTransition(grace, { kind: 'failure', at: 4_000 })).toBe(grace)
  })

  test('a failure refreshes the window only while the host answers again', () => {
    const grace: GracePhase = { phase: 'grace', lastOnlineAt: 1_000 }
    expect(graceTransition(grace, { kind: 'online', at: 5_000 })).toEqual({ phase: 'grace', lastOnlineAt: 5_000 })
  })

  test('a failure past the window, or the timer, closes it', () => {
    const grace: GracePhase = { phase: 'grace', lastOnlineAt: 1_000 }
    expect(graceTransition(grace, { kind: 'failure', at: 1_000 + DisconnectGrace.windowMs })).toEqual({
      phase: 'failed',
      lastOnlineAt: 1_000,
    })
    expect(graceTransition(grace, { kind: 'elapsed' })).toEqual({ phase: 'failed', lastOnlineAt: 1_000 })
  })

  test('a host that never answered stays unseen through failures and the timer', () => {
    expect(graceTransition({ phase: 'unseen' }, { kind: 'failure', at: 9_000 })).toEqual({ phase: 'unseen' })
    expect(graceTransition({ phase: 'unseen' }, { kind: 'elapsed' })).toEqual({ phase: 'unseen' })
  })

  test('the failure reads as reconnecting only inside an open window', () => {
    expect(graceDisplay({ state: FAILED_STATE, phase: { phase: 'grace', lastOnlineAt: 1_000 }, now: 4_000 })).toEqual({
      tone: 'idle',
      label: 'Reconnecting…',
    })
    expect(graceDisplay({ state: FAILED_STATE, phase: { phase: 'grace', lastOnlineAt: 1_000 }, now: 1_000 + DisconnectGrace.windowMs })).toBe(FAILED_STATE)
    expect(graceDisplay({ state: FAILED_STATE, phase: { phase: 'failed', lastOnlineAt: 1_000 }, now: 4_000 })).toBe(FAILED_STATE)
    expect(graceDisplay({ state: FAILED_STATE, phase: { phase: 'unseen' }, now: 4_000 })).toBe(FAILED_STATE)
  })

  test('an online or idle host is shown as itself whatever the window says', () => {
    const online = { tone: 'online' as const, label: 'Connected' }
    expect(graceDisplay({ state: online, phase: { phase: 'grace', lastOnlineAt: 1_000 }, now: 4_000 })).toBe(online)
    const idle = { tone: 'idle' as const, label: 'Idle' }
    expect(graceDisplay({ state: idle, phase: { phase: 'grace', lastOnlineAt: 1_000 }, now: 4_000 })).toBe(idle)
  })
})
