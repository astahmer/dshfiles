import { describe, expect, it } from 'vitest'
import { indexQueuedIntegrationSessions } from './queued-integrations.js'

describe('queued integration session index', () => {
  it('indexes every session sharing a queued workspace without marking unrelated sessions', () => {
    const index = indexQueuedIntegrationSessions([
      { sessionIds: ['parent', 'child'], integrationQueuedAt: 100 },
      { sessionIds: ['other'] },
      { sessionIds: [], integrationQueuedAt: 200 },
    ])
    expect([...index]).toEqual([
      ['parent', 100],
      ['child', 100],
    ])
  })

  it('accepts a zero timestamp and tolerates snapshots without queue metadata', () => {
    expect(indexQueuedIntegrationSessions([{ sessionIds: ['queued'], integrationQueuedAt: 0 }]).get('queued')).toBe(0)
    expect(indexQueuedIntegrationSessions([{ sessionIds: ['older-host'] }]).size).toBe(0)
    expect(indexQueuedIntegrationSessions([]).size).toBe(0)
  })

  it('drops the marker as soon as the next snapshot clears an integrated or cancelled queue', () => {
    const queued = { sessionIds: ['thread'], integrationQueuedAt: 100 }
    expect(indexQueuedIntegrationSessions([queued]).has('thread')).toBe(true)
    expect(indexQueuedIntegrationSessions([{ sessionIds: queued.sessionIds }]).has('thread')).toBe(false)
    expect(indexQueuedIntegrationSessions([]).has('thread')).toBe(false)
  })
})
