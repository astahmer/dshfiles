import { createActor } from 'xstate'
import { describe, expect, it } from 'vitest'
import { createHoverIntentMachine } from '../src/hover-intent-machine.js'

const createClock = () => {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { readonly at: number; readonly run: () => void }>()
  return {
    clock: {
      setTimeout: (run: () => void, timeout: number): number => {
        nextId += 1
        timers.set(nextId, { at: now + timeout, run })
        return nextId
      },
      clearTimeout: (id: number): void => {
        timers.delete(id)
      },
    },
    advance: (ms: number): void => {
      now += ms
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= now).sort((left, right) => left[1].at - right[1].at)
      for (const [id, timer] of due) {
        timers.delete(id)
        timer.run()
      }
    },
  }
}

const harness = () => {
  const { clock, advance } = createClock()
  const actor = createActor(createHoverIntentMachine({ openDelayMs: 150, closeDelayMs: 120 }), { clock }).start()
  return { actor, advance }
}

describe('hover intent machine', () => {
  it('opens on hover only after the open delay', () => {
    const { actor, advance } = harness()

    actor.send({ type: 'hover' })
    expect(actor.getSnapshot().value).toBe('opening')

    advance(149)
    expect(actor.getSnapshot().value).toBe('opening')

    advance(1)
    expect(actor.getSnapshot().value).toBe('openHover')
  })

  it('cancels a pending open when the pointer leaves during the delay', () => {
    const { actor, advance } = harness()

    actor.send({ type: 'hover' })
    advance(100)
    actor.send({ type: 'leave' })
    expect(actor.getSnapshot().value).toBe('closed')

    advance(500)
    expect(actor.getSnapshot().value).toBe('closed')
  })

  it('closes only after the close delay and reopens on a hover inside it', () => {
    const { actor, advance } = harness()
    actor.send({ type: 'hover' })
    advance(150)

    actor.send({ type: 'leave' })
    expect(actor.getSnapshot().value).toBe('closing')

    advance(100)
    actor.send({ type: 'hover' })
    expect(actor.getSnapshot().value).toBe('openHover')

    advance(500)
    expect(actor.getSnapshot().value).toBe('openHover')

    actor.send({ type: 'leave' })
    advance(120)
    expect(actor.getSnapshot().value).toBe('closed')
  })

  it('keeps a pinned menu open on hover-out until it is dismissed', () => {
    const { actor, advance } = harness()

    actor.send({ type: 'pin' })
    expect(actor.getSnapshot().value).toBe('openPinned')

    actor.send({ type: 'leave' })
    advance(500)
    expect(actor.getSnapshot().value).toBe('openPinned')

    actor.send({ type: 'dismiss' })
    expect(actor.getSnapshot().value).toBe('closed')
  })

  it('pins a hover-open menu on click and pins out of a pending close', () => {
    const { actor, advance } = harness()
    actor.send({ type: 'hover' })
    advance(150)

    actor.send({ type: 'pin' })
    actor.send({ type: 'leave' })
    advance(500)
    expect(actor.getSnapshot().value).toBe('openPinned')

    actor.send({ type: 'dismiss' })
    actor.send({ type: 'hover' })
    advance(150)
    actor.send({ type: 'leave' })
    actor.send({ type: 'pin' })
    expect(actor.getSnapshot().value).toBe('openPinned')

    advance(500)
    expect(actor.getSnapshot().value).toBe('openPinned')
  })

  it('hides immediately from any open or pending state without a later reopen', () => {
    const { actor, advance } = harness()

    actor.send({ type: 'hover' })
    actor.send({ type: 'hide' })
    expect(actor.getSnapshot().value).toBe('closed')

    advance(500)
    expect(actor.getSnapshot().value).toBe('closed')
  })

  it('dismisses a delayed open without waiting for the timer', () => {
    const { actor, advance } = harness()

    actor.send({ type: 'hover' })
    actor.send({ type: 'dismiss' })
    expect(actor.getSnapshot().value).toBe('closed')

    advance(500)
    expect(actor.getSnapshot().value).toBe('closed')
  })
})
