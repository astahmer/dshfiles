import { createActor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { autoRefreshVisibilityMachine } from './auto-refresh-machine.js'

describe('autoRefreshVisibilityMachine', () => {
  it('does not treat the initial visible state as a return', () => {
    const actor = createActor(autoRefreshVisibilityMachine, { input: { pageVisible: true } })
    let visibleReturnCount = 0
    actor.on('becameVisible', () => {
      visibleReturnCount += 1
    })
    actor.start()

    expect(visibleReturnCount).toBe(0)
    actor.send({ type: 'document.visibility', visible: true })
    expect(visibleReturnCount).toBe(0)
    actor.stop()
  })

  it('waits for every visibility gate and emits only when hidden content returns', () => {
    const actor = createActor(autoRefreshVisibilityMachine, { input: { pageVisible: false } })
    let visibleReturnCount = 0
    actor.on('becameVisible', () => {
      visibleReturnCount += 1
    })
    actor.start()

    actor.send({ type: 'element.intersection', intersecting: false })
    actor.send({ type: 'element.layout', laidOut: false })
    actor.send({ type: 'document.visibility', visible: true })
    expect(visibleReturnCount).toBe(0)

    actor.send({ type: 'element.intersection', intersecting: true })
    expect(visibleReturnCount).toBe(0)
    actor.send({ type: 'element.layout', laidOut: true })
    expect(visibleReturnCount).toBe(1)

    actor.send({ type: 'document.visibility', visible: true })
    actor.send({ type: 'element.layout', laidOut: true })
    expect(visibleReturnCount).toBe(1)

    actor.send({ type: 'element.layout', laidOut: false })
    actor.send({ type: 'element.layout', laidOut: true })
    expect(visibleReturnCount).toBe(2)
    actor.stop()
  })
})
