import { describe, expect, it } from 'vitest'
import { RunningJobsModel } from './running-jobs.js'

describe('running jobs per thread', () => {
  it('counts each thread\'s running jobs and skips jobs no thread owns', () => {
    const counts = RunningJobsModel.countsOf([{ owner: 'a' }, { owner: null }, { owner: 'b' }, { owner: 'a' }])
    expect(counts.get('a')).toBe(2)
    expect(counts.get('b')).toBe(1)
    expect(counts.size).toBe(2)
  })
})
