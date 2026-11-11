import { describe, expect, it } from 'vitest'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { SessionId } from '@dshfiles/dshx/ids'
import * as Schema from 'effect/Schema'
import { DEFAULT_IDLE_COMPACTION } from '../src/idle-compaction.js'
import { sweepIdleCompaction, type IdleCompactionCandidate } from '../src/idle-compaction-sweep.js'

const MINUTE = 60_000
const policy = { ...DEFAULT_IDLE_COMPACTION, enabled: true, lifetimeMinutes: 60, leadMinutes: 5, minTokens: 100_000 }

const id = (value: string): SessionId => Schema.decodeSync(SessionId)(value)

const candidate = (sessionId: string, overrides: Partial<IdleCompactionCandidate>): IdleCompactionCandidate => ({
  sessionId: id(sessionId),
  lastActivityAt: 1_000 * MINUTE,
  tokens: 200_000,
  stillIdle: () => true,
  compact: () => Promise.resolve(null),
  ...overrides,
})

describe('sweepIdleCompaction', () => {
  it('compacts only the threads due, once per idle stretch, and records its span', async () => {
    using recorder = recordSpans()
    const compacted: string[] = []
    const compact = (id: string) => () => {
      compacted.push(id)
      return Promise.resolve(null)
    }
    const done = await sweepIdleCompaction({
      now: 1_056 * MINUTE,
      candidates: [
        candidate('due', { compact: compact('due') }),
        candidate('small', { tokens: 1_000, compact: compact('small') }),
        candidate('used', { lastActivityAt: 1_055 * MINUTE, compact: compact('used') }),
        candidate('done', { compact: compact('done') }),
        candidate('unmeasured', { tokens: null, compact: compact('unmeasured') }),
      ],
      attemptedAt: new Map([[id('done'), 1_000 * MINUTE]]),
      policy,
    })
    expect(compacted).toEqual(['due', 'unmeasured'])
    expect(done).toEqual([id('due'), id('unmeasured')])
    expect(recorder.span('context compaction idle sweep').attributes).toEqual({ candidates: 5 })
  })

  it('does nothing while the feature is off', async () => {
    let calls = 0
    const done = await sweepIdleCompaction({
      now: 9_999 * MINUTE,
      candidates: [
        candidate('due', {
          compact: () => {
            calls += 1
            return Promise.resolve(null)
          },
        }),
      ],
      attemptedAt: new Map(),
      policy: DEFAULT_IDLE_COMPACTION,
    })
    expect(done).toEqual([])
    expect(calls).toBe(0)
  })

  it('keeps sweeping after one thread refuses maintenance, and records that attempt', async () => {
    const failures: string[] = []
    const attempts: string[] = []
    const compacted: string[] = []
    const attemptedAt = new Map<SessionId, number>()
    const done = await sweepIdleCompaction({
      now: 1_056 * MINUTE,
      candidates: [
        candidate('busy', { compact: () => Promise.reject(new Error('busy')) }),
        candidate('free', {
          compact: () => {
            compacted.push('free')
            return Promise.resolve(null)
          },
        }),
      ],
      attemptedAt,
      policy,
      onAttempt: ({ sessionId, lastActivityAt }) => {
        attempts.push(sessionId)
        attemptedAt.set(sessionId, lastActivityAt)
      },
      onFailure: ({ sessionId }) => failures.push(sessionId),
    })
    expect(failures).toEqual([id('busy')])
    expect(attempts).toEqual([id('busy'), id('free')])
    expect(compacted).toEqual(['free'])
    expect(done).toEqual([id('free')])
  })

  it('bills a failed attempt once per idle stretch instead of retrying every sweep', async () => {
    const attemptedAt = new Map<SessionId, number>()
    let calls = 0
    const failing = (lastActivityAt: number) =>
      candidate('flaky', {
        lastActivityAt,
        compact: () => {
          calls += 1
          return Promise.reject(new Error('provider failed after billing'))
        },
      })
    const sweep = (now: number, lastActivityAt: number) =>
      sweepIdleCompaction({
        now,
        candidates: [failing(lastActivityAt)],
        attemptedAt,
        policy,
        onAttempt: ({ sessionId, lastActivityAt }) => attemptedAt.set(sessionId, lastActivityAt),
      })

    await sweep(1_056 * MINUTE, 1_000 * MINUTE)
    await sweep(1_057 * MINUTE, 1_000 * MINUTE)
    expect(calls).toBe(1)

    await sweep(1_060 * MINUTE, 1_001 * MINUTE)
    expect(calls).toBe(2)
  })

  it('rechecks the live thread immediately before the billed request', async () => {
    const rechecked: string[] = []
    let calls = 0
    const done = await sweepIdleCompaction({
      now: 1_056 * MINUTE,
      candidates: [
        candidate('gained-work', {
          stillIdle: () => {
            rechecked.push('gained-work')
            return false
          },
          compact: () => {
            calls += 1
            return Promise.resolve(null)
          },
        }),
      ],
      attemptedAt: new Map(),
      policy,
    })
    expect(rechecked).toEqual([id('gained-work')])
    expect(calls).toBe(0)
    expect(done).toEqual([])
  })

  it('skips an unknown idle start and an expired stretch without calling or rechecking', async () => {
    let calls = 0
    let rechecks = 0
    const done = await sweepIdleCompaction({
      now: 1_060 * MINUTE,
      candidates: [
        candidate('unknown', { lastActivityAt: null, stillIdle: () => (rechecks += 1) > 0 }),
        candidate('expired', { lastActivityAt: 1_000 * MINUTE, stillIdle: () => (rechecks += 1) > 0 }),
      ],
      attemptedAt: new Map(),
      policy,
      onAttempt: () => {
        calls += 1
      },
    })
    expect(rechecks).toBe(0)
    expect(calls).toBe(0)
    expect(done).toEqual([])
  })
})
