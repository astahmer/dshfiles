import { createActor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { pairingMachine } from './pairing-machine.js'

const start = () => {
  const actor = createActor(pairingMachine)
  actor.start()
  return actor
}

describe('pairingMachine', () => {
  it('opens the window only after the Host accepts the arm request', () => {
    const actor = start()
    expect(actor.getSnapshot().matches('idle')).toBe(true)

    actor.send({ type: 'arm' })
    expect(actor.getSnapshot().matches('arming')).toBe(true)

    actor.send({ type: 'armed' })
    expect(actor.getSnapshot().matches('armed')).toBe(true)
    actor.stop()
  })

  it('returns to idle when arming fails, so the button can be pressed again', () => {
    const actor = start()
    actor.send({ type: 'arm' })
    actor.send({ type: 'arm.failed' })
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    actor.send({ type: 'arm' })
    expect(actor.getSnapshot().matches('arming')).toBe(true)
    actor.stop()
  })

  it('stops waiting once the extension reports it paired', () => {
    const actor = start()
    actor.send({ type: 'arm' })
    actor.send({ type: 'armed' })
    actor.send({ type: 'paired' })
    expect(actor.getSnapshot().matches('paired')).toBe(true)
    actor.stop()
  })

  it('re-arms from a paired session, then accepts the still-paired status', () => {
    const actor = start()
    actor.send({ type: 'arm' })
    actor.send({ type: 'armed' })
    actor.send({ type: 'paired' })

    actor.send({ type: 'arm' })
    expect(actor.getSnapshot().matches('arming')).toBe(true)
    actor.send({ type: 'armed' })
    actor.send({ type: 'paired' })
    expect(actor.getSnapshot().matches('paired')).toBe(true)
    actor.stop()
  })

  it('ignores a pairing report while no window is armed', () => {
    const actor = start()
    actor.send({ type: 'paired' })
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    actor.stop()
  })
})
