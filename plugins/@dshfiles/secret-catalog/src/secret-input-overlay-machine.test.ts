import { createActor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import type { FieldAnchor } from './secret-input-overlay-machine.js'
import { secretInputOverlayMachine } from './secret-input-overlay-machine.js'
import { SecretSetupSteps } from './secret-setup-step.js'

// SAFETY: the machine only compares anchors by identity; a bare object stands in for the DOM field.
const field = (name: string): HTMLInputElement => ({ dataset: { field: name } }) as unknown as HTMLInputElement

// SAFETY: the machine only carries the anchor's rect; a bare object stands in for a DOM rect.
const anchorOf = (element: HTMLInputElement): FieldAnchor => ({ element, rect: {} as DOMRect })

const start = () => {
  const actor = createActor(secretInputOverlayMachine)
  actor.start()
  return actor
}

describe('secretInputOverlayMachine', () => {
  it('anchors on focus, opens on the picker button and closes on blur', () => {
    const actor = start()
    const token = field('token')

    actor.send({ type: 'focus', anchor: anchorOf(token) })
    expect(actor.getSnapshot().matches('closed')).toBe(true)
    expect(actor.getSnapshot().context.anchor?.element).toBe(token)

    actor.send({ type: 'toggle', jevField: false })
    expect(actor.getSnapshot().matches('list')).toBe(true)

    actor.send({ type: 'toggle', jevField: false })
    expect(actor.getSnapshot().matches('closed')).toBe(true)

    actor.send({ type: 'blur' })
    expect(actor.getSnapshot().matches('detached')).toBe(true)
    expect(actor.getSnapshot().context.anchor).toBeNull()
    actor.stop()
  })

  it('opens the create form for a marked field and keeps its stored step across a close', () => {
    const actor = start()
    const token = field('token')

    actor.send({ type: 'create', anchor: anchorOf(token) })
    expect(actor.getSnapshot().matches('create')).toBe(true)
    actor.send({ type: 'step', step: { kind: 'created', reference: 'secret:TOKEN@prod', error: 'bind' } })
    expect(actor.getSnapshot().context.create?.step).toEqual({ kind: 'created', reference: 'secret:TOKEN@prod', error: 'bind' })

    actor.send({ type: 'cancel.create' })
    expect(actor.getSnapshot().matches('list')).toBe(true)
    actor.send({ type: 'open.create' })
    expect(actor.getSnapshot().context.create?.step).toEqual({ kind: 'created', reference: 'secret:TOKEN@prod', error: 'bind' })

    actor.send({ type: 'bound' })
    expect(actor.getSnapshot().matches('closed')).toBe(true)
    expect(actor.getSnapshot().context.create).toBeNull()
    actor.stop()
  })

  it('drops a create step that belongs to another field', () => {
    const actor = start()
    const first = field('first')
    const second = field('second')

    actor.send({ type: 'create', anchor: anchorOf(first) })
    actor.send({ type: 'step', step: SecretSetupSteps.createSettled({ reference: 'secret:FIRST@prod', bound: false }) })
    actor.send({ type: 'blur' })
    actor.send({ type: 'focus', anchor: anchorOf(second) })

    expect(actor.getSnapshot().matches('closed')).toBe(true)
    expect(actor.getSnapshot().context.create).toBeNull()
    actor.send({ type: 'create', anchor: anchorOf(second) })
    expect(actor.getSnapshot().context.create?.step).toEqual({ kind: 'draft', error: null })
    actor.stop()
  })

  it('auto-opens once per unresolved reference and leaves a saving Jev key alone', () => {
    const actor = start()
    actor.send({ type: 'focus', anchor: anchorOf(field('jev')) })

    actor.send({ type: 'reference.unresolved', reference: 'secret:JEV@prod' })
    expect(actor.getSnapshot().matches('list')).toBe(true)
    expect(actor.getSnapshot().context.autoOpened).toBe('secret:JEV@prod')

    actor.send({ type: 'open.jev' })
    expect(actor.getSnapshot().matches({ jevSetup: 'editing' })).toBe(true)
    actor.send({ type: 'jev.pending', pending: true })
    expect(actor.getSnapshot().matches({ jevSetup: 'saving' })).toBe(true)

    actor.send({ type: 'toggle', jevField: true })
    actor.send({ type: 'blur' })
    actor.send({ type: 'create', anchor: anchorOf(field('jev')) })
    expect(actor.getSnapshot().matches({ jevSetup: 'saving' })).toBe(true)

    actor.send({ type: 'jev.pending', pending: false })
    expect(actor.getSnapshot().matches({ jevSetup: 'editing' })).toBe(true)
    actor.send({ type: 'toggle', jevField: true })
    expect(actor.getSnapshot().matches('closed')).toBe(true)

    actor.send({ type: 'reference.unresolved', reference: 'secret:JEV@prod' })
    expect(actor.getSnapshot().matches('closed')).toBe(true)
    actor.send({ type: 'reference.unresolved', reference: 'secret:OTHER@prod' })
    expect(actor.getSnapshot().matches('list')).toBe(true)
    actor.stop()
  })

  it('closes to nothing once the Jev key is saved', () => {
    const actor = start()
    actor.send({ type: 'focus', anchor: anchorOf(field('jev')) })
    actor.send({ type: 'toggle', jevField: true })
    actor.send({ type: 'jev.saved' })

    expect(actor.getSnapshot().matches('detached')).toBe(true)
    expect(actor.getSnapshot().context.anchor).toBeNull()
    actor.stop()
  })

  it('reattaches the panel to the field a create request names, even while it was closed for another', () => {
    const actor = start()
    actor.send({ type: 'focus', anchor: anchorOf(field('first')) })
    actor.send({ type: 'toggle', jevField: false })
    const second = field('second')
    actor.send({ type: 'create', anchor: anchorOf(second) })

    expect(actor.getSnapshot().matches('create')).toBe(true)
    expect(actor.getSnapshot().context.anchor?.element).toBe(second)
    actor.stop()
  })
})
