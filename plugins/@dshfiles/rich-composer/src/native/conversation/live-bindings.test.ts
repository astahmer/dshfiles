import { describe, expect, it } from 'vitest'
import { liveViewBindings } from './live-bindings.js'

const binding = (sessionId: string) => ({ sessionId })

describe('liveViewBindings', () => {
  it('forgets a binding whose generation was replaced and keeps the current one', () => {
    const dropped = binding('old')
    const kept = binding('current')
    const bindings = new Set([dropped, kept])
    const onDrop: string[] = []

    const live = liveViewBindings({
      bindings,
      current: sessionId => (sessionId === 'current' ? kept : binding(sessionId)),
      onDrop: value => { onDrop.push(value.sessionId) },
    })

    expect(live).toEqual([kept])
    expect([...bindings]).toEqual([kept])
    expect(onDrop).toEqual(['old'])
  })
})
