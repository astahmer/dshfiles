import type { SessionId } from '@dshfiles/dshx/ids'
import type { IdleCompactionCandidate } from './idle-compaction-sweep.js'

/** The live Agent facts the sweep may read; absent for a cold thread the controller has not resumed. */
export interface LiveAgentIdleState {
  readonly status: 'idle' | 'running'
  readonly nextTurn: number
  readonly nextStep: number
}

/**
 * Build one sweep candidate from this Host's own observation.
 *
 * `observedLastActivityAt` is the last request or turn end this Host saw for the thread since activation, kept across
 * Agent eviction. There is deliberately no fallback to the thread list's `updatedAt`: that number is the last human
 * prompt, so using it would compact a thread whose turn ran long after it. A null observation skips the thread.
 */
export const observedIdleCandidate = (input: {
  readonly sessionId: SessionId
  readonly observedLastActivityAt: number | null
  readonly currentLastActivityAt: () => number | null
  readonly liveAgent: () => LiveAgentIdleState | undefined
  readonly tokens: number | null
  readonly compact: () => Promise<void>
}): IdleCompactionCandidate | null => {
  if (input.observedLastActivityAt === null) return null
  const observedLastActivityAt = input.observedLastActivityAt
  return {
    sessionId: input.sessionId,
    lastActivityAt: observedLastActivityAt,
    tokens: input.tokens,
    stillIdle: () => {
      if (input.currentLastActivityAt() !== observedLastActivityAt) return false
      const agent = input.liveAgent()
      // A cold thread has no live turn or inbox to race; its observed request is the safe idle start.
      if (agent === undefined) return true
      return agent.status === 'idle' && agent.nextTurn === 0 && agent.nextStep === 0
    },
    compact: input.compact,
  }
}
