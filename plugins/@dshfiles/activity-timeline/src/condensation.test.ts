import { describe, expect, it } from 'vitest'
import { ActivityTimelineCondensation } from './condensation.js'
import type { ActivityEvent } from './types.js'

const minute = 60_000
const refusalHint = 'default@ carries described work that main does not have yet. Rebase it onto main, then sync again.'

const event = (patch: Partial<ActivityEvent> & Pick<ActivityEvent, 'id' | 'at'>): ActivityEvent => ({
  source: 'workspace',
  type: 'workspace.sync_refused',
  level: 'attention',
  sessionId: null,
  workspaceId: '/repo',
  taskId: null,
  correlationId: null,
  causationId: null,
  summary: 'default kept as is: sync refused, local work preserved',
  detail: refusalHint,
  metadata: {},
  references: [],
  provenance: 'reported',
  ...patch,
})

const refusal = (index: number, patch: Partial<ActivityEvent> = {}): ActivityEvent =>
  event({ id: `refusal-${String(index)}`, at: index * minute, sessionId: `session-${String(index % 3)}`, ...patch })

describe('repeated sync refusals', () => {
  it('fold a burst with one cause into one attention row that counts them and keeps every event id', () => {
    const burst = Array.from({ length: 10 }, (_, index) => refusal(index + 1))
    const items = ActivityTimelineCondensation.condenseEvents(burst)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'group',
      id: 'repeated:refusal-1',
      level: 'attention',
      type: 'workspace.sync_refused',
      count: 10,
      at: 10 * minute,
      sessionId: null,
      summary: '10× default kept as is: sync refused, local work preserved · across 3 agents',
    })
    expect(items[0]?.eventIds).toEqual(burst.map(member => member.id))
  })

  it('keep the row at its newest member while unrelated events interleave', () => {
    const items = ActivityTimelineCondensation.condenseEvents([
      refusal(1),
      event({ id: 'error', at: 2 * minute, source: 'session', type: 'session.error', summary: 'agent error' }),
      refusal(3),
    ])
    expect(items.map(item => item.id)).toEqual(['error', 'repeated:refusal-1'])
  })

  it('keep refusals with another cause, another checkout or outside the burst window apart', () => {
    const items = ActivityTimelineCondensation.condenseEvents([
      refusal(1),
      refusal(2, { detail: 'Rebasing default would rewrite the working copy of b227. Rebase that work first.' }),
      refusal(3, { workspaceId: '/other-repo' }),
      refusal(45),
    ])
    expect(items.map(item => [item.kind, item.count])).toEqual([
      ['event', 1],
      ['event', 1],
      ['event', 1],
      ['event', 1],
    ])
  })

  it('leave a single refusal and other attention events individual, and every event in detailed mode', () => {
    const failures = [1, 2].map(index => refusal(index, { type: 'workspace.sync_failed', summary: 'default not updated: conflicts' }))
    expect(ActivityTimelineCondensation.condenseEvents(failures).map(item => item.kind)).toEqual(['event', 'event'])
    expect(ActivityTimelineCondensation.condenseEvents([refusal(1)])[0]).toMatchObject({ kind: 'event', id: 'refusal-1' })
    expect(ActivityTimelineCondensation.condenseEvents([refusal(1), refusal(2)], { detailed: true })).toHaveLength(2)
  })
})
