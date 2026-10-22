import { describe, expect, it } from 'vitest'
import { actorThreadFor } from './actor-thread.js'
import type { ComposerThread } from './composer.js'

const threads: readonly ComposerThread[] = [
  { id: 'session-agent', title: 'Review provider changes', running: false },
  { id: 'session-other', title: 'Different thread', running: true },
]

describe('actor thread lookup', () => {
  it('resolves agent actors to the thread they worked in', () => {
    expect(actorThreadFor('agent:session-agent', threads)).toEqual(threads[0])
  })

  it('does not treat humans, system actors, or missing threads as agent threads', () => {
    expect(actorThreadFor('user', threads)).toBeUndefined()
    expect(actorThreadFor('system', threads)).toBeUndefined()
    expect(actorThreadFor('agent:unknown', threads)).toBeUndefined()
  })
})
