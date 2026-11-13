import { describe, expect, it } from 'vitest'
import { createMissingThreads } from './missing-threads.js'

describe('missing thread tabs', () => {
  it('keeps a thread that is missing from one list snapshot and back in the next', () => {
    const missing = createMissingThreads(3_000)
    expect(missing.observe(['a'], 0)).toEqual({ gone: [], recheckInMs: 3_000 })
    expect(missing.observe([], 800)).toEqual({ gone: [], recheckInMs: null })
    // Missing again later starts a new grace period instead of continuing the old one.
    expect(missing.observe(['a'], 3_500)).toEqual({ gone: [], recheckInMs: 3_000 })
  })

  it('reports a thread gone once it stayed missing for the whole grace period', () => {
    const missing = createMissingThreads(3_000)
    missing.observe(['a'], 0)
    expect(missing.observe(['a', 'b'], 1_000)).toEqual({ gone: [], recheckInMs: 2_000 })
    expect(missing.observe(['a', 'b'], 3_000)).toEqual({ gone: ['a'], recheckInMs: 1_000 })
    expect(missing.observe(['b'], 4_000)).toEqual({ gone: ['b'], recheckInMs: null })
  })
})
