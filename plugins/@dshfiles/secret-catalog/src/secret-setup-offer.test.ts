import { describe, expect, it } from 'vitest'
import { SecretSetupOffer } from './secret-setup-offer.js'
import { SecretSetupSteps } from './secret-setup-step.js'

const opened = (ids: readonly string[]) => SecretSetupOffer.open({ state: SecretSetupOffer.initial(), ids })

describe('SecretSetupOffer', () => {
  it('offers every requirement, opens them all and closes back to rows', () => {
    const state = opened(['A', 'B'])

    expect(state.panel).toBe('open')
    expect(SecretSetupOffer.editing(state, 'A')).toBe(false)
    expect(SecretSetupOffer.createdReference(state, 'A')).toBeUndefined()

    const editing = SecretSetupOffer.edit({ state, id: 'A' })
    expect(SecretSetupOffer.editing(editing, 'A')).toBe(true)
    expect(SecretSetupOffer.editing(editing, 'B')).toBe(false)

    const closed = SecretSetupOffer.close(editing)
    expect(closed.panel).toBe('closed')
    expect(SecretSetupOffer.editing(closed, 'A')).toBe(false)
  })

  it('refuses to close over a create or a bind in flight', () => {
    const creating = SecretSetupOffer.step({ state: opened(['A']), id: 'A', step: { kind: 'creating' } })

    expect(SecretSetupOffer.busy(creating)).toBe(true)
    expect(SecretSetupOffer.close(creating)).toBe(creating)
    expect(SecretSetupOffer.cancel({ state: creating, id: 'A' })).toBe(creating)
  })

  it('keeps the stored reference of a failed bind across a close, and resumes at that bind', () => {
    const created = SecretSetupOffer.step({
      state: opened(['A']),
      id: 'A',
      step: SecretSetupSteps.createSettled({ reference: 'secret:A@prod', bound: false }),
    })
    const closed = SecretSetupOffer.close(created)

    expect(SecretSetupOffer.editing(closed, 'A')).toBe(false)
    expect(SecretSetupOffer.createdReference(closed, 'A')).toBe('secret:A@prod')

    const resumed = SecretSetupOffer.edit({ state: closed, id: 'A' })
    expect(resumed.requirements.A).toEqual({ kind: 'editing', step: { kind: 'created', reference: 'secret:A@prod', error: null } })
  })

  it('drops a cancelled draft but remembers the reference a created form already stored', () => {
    const draft = SecretSetupOffer.step({ state: opened(['A']), id: 'A', step: { kind: 'draft', error: 'folder' } })
    const cancelled = SecretSetupOffer.cancel({ state: draft, id: 'A' })

    expect(cancelled.requirements.A).toEqual({ kind: 'offered', createdReference: null })

    const created = SecretSetupOffer.step({
      state: opened(['B']),
      id: 'B',
      step: { kind: 'created', reference: 'secret:B@prod', error: 'bind' },
    })
    expect(SecretSetupOffer.cancel({ state: created, id: 'B' }).requirements.B).toEqual({ kind: 'offered', createdReference: 'secret:B@prod' })
  })

  it('marks a requirement bound and stops offering it a form', () => {
    const state = opened(['A'])
    const bound = SecretSetupOffer.markBound({ state, id: 'A', reference: 'secret:A@prod' })

    expect(SecretSetupOffer.bound(bound, 'A')).toBe(true)
    expect(SecretSetupOffer.editing(bound, 'A')).toBe(false)
    expect(SecretSetupOffer.busy(bound)).toBe(false)
    expect(SecretSetupOffer.close(bound).requirements.A).toEqual({ kind: 'bound', reference: 'secret:A@prod' })
  })

  it('prunes requirements that are no longer missing without touching the others', () => {
    const state = SecretSetupOffer.markBound({ state: opened(['A', 'B']), id: 'A', reference: 'secret:A@prod' })
    const pruned = SecretSetupOffer.prune({ state, ids: ['A'] })

    expect(Object.keys(pruned.requirements)).toEqual(['A'])
    expect(SecretSetupOffer.prune({ state: pruned, ids: ['A'] })).toBe(pruned)
  })
})
