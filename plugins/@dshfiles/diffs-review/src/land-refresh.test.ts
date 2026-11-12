import { describe, expect, it } from 'vitest'
import { afterLand } from './land-refresh.js'

describe('afterLand', () => {
  it('announces the repository change so the thread list stops reading "N to land" after a land', () => {
    const calls: string[] = []
    afterLand({
      invalidateOwn: () => calls.push('own'),
      announceRepositoryChange: () => calls.push('announce'),
      onLanded: () => calls.push('landed'),
    })
    expect(calls).toEqual(['own', 'announce', 'landed'])
  })
})
