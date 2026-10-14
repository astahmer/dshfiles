import { describe, expect, it } from 'vitest'

import { livePurposeOf } from './live-calls.js'

describe('live call purpose', () => {
  it('tags OptMem summaries and memory digests as memory summaries, other compactions as compaction', () => {
    expect(livePurposeOf({ purpose: 'compaction', system: 'You maintain the long-term memory of a software engineering assistant.' })).toBe('memory')
    expect(livePurposeOf({ purpose: 'compaction', system: 'You write the digest of one finished software-engineering thread for a memory index.' })).toBe(
      'memory',
    )
    expect(livePurposeOf({ purpose: 'compaction', system: 'Summarize the conversation so far.' })).toBe('compaction')
  })
})
