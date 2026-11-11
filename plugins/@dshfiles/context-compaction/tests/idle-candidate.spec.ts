import { describe, expect, it } from 'vitest'
import { SessionId } from '@dshfiles/dshx/ids'
import * as Schema from 'effect/Schema'
import { observedIdleCandidate, type LiveAgentIdleState } from '../src/idle-candidate.js'

const id = (value: string): SessionId => Schema.decodeSync(SessionId)(value)

const idle: LiveAgentIdleState = { status: 'idle', nextTurn: 0, nextStep: 0 }

/** What the candidate reads live: the thread's last activity and its agent, changed by each case. */
interface LiveThread {
  observed: number | null
  agent: LiveAgentIdleState | undefined
}

const build = (overrides: Partial<Parameters<typeof observedIdleCandidate>[0]> = {}) => {
  const state: LiveThread = { observed: 1_000, agent: idle }
  const candidate = observedIdleCandidate({
    sessionId: id('thread'),
    observedLastActivityAt: 1_000,
    currentLastActivityAt: () => state.observed,
    liveAgent: () => state.agent,
    tokens: 200_000,
    compact: () => Promise.resolve(),
    ...overrides,
  })
  return { candidate, state }
}

describe('observedIdleCandidate', () => {
  it('skips a thread whose idle start this Host never observed, with no fallback timestamp', () => {
    const { candidate } = build({ observedLastActivityAt: null })
    expect(candidate).toBeNull()
  })

  it('accepts an observed resident thread only while it stays idle without queued input', () => {
    const { candidate, state } = build()
    expect(candidate?.lastActivityAt).toBe(1_000)
    expect(candidate?.stillIdle()).toBe(true)

    state.agent = { ...idle, status: 'running' }
    expect(candidate?.stillIdle()).toBe(false)
    state.agent = { ...idle, nextTurn: 1 }
    expect(candidate?.stillIdle()).toBe(false)
    state.agent = { ...idle, nextStep: 1 }
    expect(candidate?.stillIdle()).toBe(false)
  })

  it('rejects a stale candidate whose observed idle start moved after collection', () => {
    const { candidate, state } = build()
    state.observed = 1_000_001
    expect(candidate?.stillIdle()).toBe(false)
  })

  it('keeps a cold thread eligible from the request time observed before its Agent was evicted', () => {
    const { candidate, state } = build()
    state.agent = undefined
    expect(candidate?.stillIdle()).toBe(true)
  })

  it('keeps an unmeasured thread, leaving the token floor to the controller’s own admission', () => {
    const { candidate } = build({ tokens: null })
    expect(candidate?.tokens).toBeNull()
  })
})
