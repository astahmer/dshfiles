import { describe, expect, it } from 'vitest'
import { issueBackoffAfter, type IssueBackoff } from './pull-request-state.js'

const minutes = (count: number): number => count * 60_000

describe('issue read backoff', () => {
  it('waits five minutes after a rate limit, doubling per consecutive limit up to an hour', () => {
    let backoff: IssueBackoff = { until: 0, count: 0 }
    const waits: number[] = []
    for (let limit = 0; limit < 7; limit += 1) {
      backoff = issueBackoffAfter({ previous: backoff, now: 1_000, rateLimited: true })
      waits.push(backoff.until - 1_000)
    }
    expect(waits).toEqual([minutes(5), minutes(10), minutes(20), minutes(40), minutes(60), minutes(60), minutes(60)])
    expect(backoff.count).toBe(7)
  })

  it('resets after a read that went through, so the next limit starts at five minutes again', () => {
    const limited = issueBackoffAfter({ previous: { until: 0, count: 3 }, now: 0, rateLimited: true })
    expect(limited).toEqual({ until: minutes(40), count: 4 })
    const cleared = issueBackoffAfter({ previous: limited, now: minutes(41), rateLimited: false })
    expect(cleared).toEqual({ until: 0, count: 0 })
    expect(issueBackoffAfter({ previous: cleared, now: minutes(50), rateLimited: true })).toEqual({ until: minutes(55), count: 1 })
  })
})
