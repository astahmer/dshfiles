import { describe, expect, it } from 'vitest'

import { backlogActivity } from './adapters.js'
import { backlogActivitySchema } from './types.js'

describe('backlog activity', () => {
  it('maps a request for input to an attention event referencing its thread', () => {
    const input = backlogActivitySchema.parse({
      id: 'backlog:2:100:edited',
      at: 100,
      type: 'backlog.attention',
      level: 'attention',
      summary: 'Agent b81d03 asked for your input on b:2 Migrate users table',
      detail: null,
      itemId: 2,
      sessionId: 'session-b81d03',
      revision: null,
    })
    expect(backlogActivity(input)).toEqual({
      id: 'backlog:2:100:edited',
      at: 100,
      source: 'system',
      type: 'backlog.attention',
      level: 'attention',
      summary: 'Agent b81d03 asked for your input on b:2 Migrate users table',
      detail: null,
      sessionId: 'session-b81d03',
      metadata: { itemId: 2 },
      references: [{ kind: 'session', id: 'session-b81d03', label: null }],
      provenance: 'reported',
    })
  })

  it('refuses payloads outside the contract', () => {
    expect(
      backlogActivitySchema.safeParse({
        id: 'x',
        at: 1,
        type: 'backlog.deleted',
        level: 'routine',
        summary: 's',
        detail: null,
        itemId: 1,
        sessionId: null,
        revision: null,
      }).success,
    ).toBe(false)
  })
})
