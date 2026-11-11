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
        candidate('cold', { tokens: null, compact: compact('cold') }),
      ],
      compactedAt: new Map([[id('done'), 1_000 * MINUTE]]),
      policy,
    })
    expect(compacted).toEqual(['due'])
    expect(done).toEqual([id('due')])
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
      compactedAt: new Map(),
      policy: DEFAULT_IDLE_COMPACTION,
    })
    expect(done).toEqual([])
    expect(calls).toBe(0)
  })

  it('keeps sweeping after one thread refuses maintenance', async () => {
    const failures: string[] = []
    const compacted: string[] = []
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
      compactedAt: new Map(),
      policy,
      onFailure: ({ sessionId }) => failures.push(sessionId),
    })
    expect(failures).toEqual([id('busy')])
    expect(compacted).toEqual(['free'])
    expect(done).toEqual([id('free')])
  })
})
