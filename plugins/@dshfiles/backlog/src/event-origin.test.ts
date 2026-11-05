import { describe, expect, it } from 'vitest'

import { BacklogOrigins } from './event-origin.js'
import type { BacklogEvent } from './item.js'

const event = (fields: Partial<BacklogEvent>): BacklogEvent => ({ at: 1, actor: 'user', kind: 'commented', detail: 'hello', ...fields })

describe('event origin', () => {
  it('keeps a stored origin', () => {
    expect(BacklogOrigins.of(event({ actor: 'system', origin: 'remote:github' }))).toBe('remote:github')
  })

  it('derives a legacy origin from the actor', () => {
    expect(BacklogOrigins.of(event({ actor: 'user' }))).toBe('user')
    expect(BacklogOrigins.of(event({ actor: 'agent:session-abc', kind: 'moved' }))).toBe('agent:session-abc')
    expect(BacklogOrigins.of(event({ actor: 'system', kind: 'triaged' }))).toBe('system')
  })

  it('reads a legacy synced comment as written on its tracker', () => {
    expect(BacklogOrigins.of(event({ actor: 'system', detail: 'Linear · Ada: looks good' }))).toBe('remote:linear')
    expect(BacklogOrigins.of(event({ actor: 'system', detail: 'GitHub · octo: +1' }))).toBe('remote:github')
    expect(BacklogOrigins.of(event({ actor: 'system', detail: 'Sync conflict with Linear ENG-1' }))).toBe('system')
    expect(BacklogOrigins.of(event({ actor: 'user', detail: 'Linear · me: typed by hand' }))).toBe('user')
  })

  it('stamps a missing origin without touching a stored one', () => {
    const stored = event({ origin: 'agent:session-x', actor: 'agent:session-x' })
    expect(BacklogOrigins.stamped(stored)).toBe(stored)
    expect(BacklogOrigins.stamped(event({ actor: 'system', detail: 'GitHub · octo: hi' })).origin).toBe('remote:github')
  })

  it('names agent and remote origins', () => {
    expect(BacklogOrigins.isAgent('agent:session-x')).toBe(true)
    expect(BacklogOrigins.isAgent('user')).toBe(false)
    expect(BacklogOrigins.isRemote('remote:linear')).toBe(true)
    expect(BacklogOrigins.isRemote('system')).toBe(false)
  })
})
