import { describe, expect, it } from 'vitest'
import { IntegrationAttribution } from './integration-attribution.js'

const records = [{ at: 100, sessionId: 'parent' }, { at: 200 }, { at: 300, sessionId: 'fork' }, { at: 400, sessionId: 'parent' }]

describe('IntegrationAttribution', () => {
  it('bounds a fork by its cut and keeps only its own later lands', () => {
    expect(IntegrationAttribution.forSession({ records, sessionId: 'fork', forkCutAt: 250 })).toEqual([
      { at: 100, sessionId: 'parent' },
      { at: 200 },
      { at: 300, sessionId: 'fork' },
    ])
  })

  it('hides a land the fork never asked for once the fork was cut', () => {
    expect(IntegrationAttribution.forSession({ records, sessionId: 'fork', forkCutAt: 150 })).toEqual([
      { at: 100, sessionId: 'parent' },
      { at: 300, sessionId: 'fork' },
    ])
  })

  it('keeps an ordinary Session to its own lands and the unattributed history', () => {
    expect(IntegrationAttribution.forSession({ records, sessionId: 'parent', forkCutAt: undefined })).toEqual([
      { at: 100, sessionId: 'parent' },
      { at: 200 },
      { at: 400, sessionId: 'parent' },
    ])
  })

  it('shows every record to a caller without a Session', () => {
    expect(IntegrationAttribution.forSession({ records, sessionId: undefined, forkCutAt: 250 })).toBe(records)
  })
})
