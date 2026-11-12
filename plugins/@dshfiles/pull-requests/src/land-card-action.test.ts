import { describe, expect, it } from 'vitest'
import { describeChecks } from './land-card-action.js'

describe('Land card pull request checks', () => {
  it('says nothing before CI reports', () => {
    expect(describeChecks([])).toBeUndefined()
  })

  it('reports failures first, then running checks, then a pass', () => {
    expect(describeChecks([{ status: 'SUCCESS' }, { status: 'FAILURE' }, { status: 'IN_PROGRESS' }, { status: 'SUCCESS' }])).toEqual({
      text: '1 of 4 checks failed',
      failed: true,
    })
    expect(describeChecks([{ status: 'SUCCESS' }, { status: 'QUEUED' }])).toEqual({ text: '1 of 2 checks running', failed: false })
    expect(describeChecks([{ status: 'SUCCESS' }, { status: 'SKIPPED' }, { status: 'NEUTRAL' }])).toEqual({ text: '3 checks passed', failed: false })
    expect(describeChecks([{ status: 'TIMED_OUT' }])).toEqual({ text: '1 check failed', failed: true })
  })
})
