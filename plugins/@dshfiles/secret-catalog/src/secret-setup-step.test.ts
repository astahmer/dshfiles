import { describe, expect, it } from 'vitest'
import { SecretSetupSteps } from './secret-setup-step.js'

describe('SecretSetupSteps', () => {
  it('starts a draft with no error and creates only from one', () => {
    const start = SecretSetupSteps.draft()
    expect(start).toEqual({ kind: 'draft', error: null })
    expect(SecretSetupSteps.startCreate(start)).toEqual({ kind: 'creating' })
    expect(SecretSetupSteps.startCreate({ kind: 'bound', reference: 'secret:A@prod' })).toEqual({ kind: 'bound', reference: 'secret:A@prod' })
  })

  it('keeps the stored reference when the bind after a create fails, and retries that same reference', () => {
    const created = SecretSetupSteps.createSettled({ reference: 'secret:A@prod', bound: false })

    expect(created).toEqual({ kind: 'created', reference: 'secret:A@prod', error: 'bind' })
    expect(SecretSetupSteps.createdReference(created)).toBe('secret:A@prod')
    expect(SecretSetupSteps.busy(created)).toBe(false)

    const binding = SecretSetupSteps.startBind({ step: created, reference: 'secret:A@prod', origin: 'created' })
    expect(binding).toEqual({ kind: 'binding', reference: 'secret:A@prod', origin: 'created' })
    expect(SecretSetupSteps.busy(binding)).toBe(true)
    expect(SecretSetupSteps.createdReference(binding)).toBe('secret:A@prod')
    expect(SecretSetupSteps.bindSettled({ step: binding, bound: false })).toEqual({
      kind: 'created',
      reference: 'secret:A@prod',
      error: 'bind',
    })
    expect(SecretSetupSteps.bindSettled({ step: binding, bound: true })).toEqual({ kind: 'bound', reference: 'secret:A@prod' })
  })

  it('returns to the draft when binding an existing secret fails, so the draft stays editable', () => {
    const binding = SecretSetupSteps.startBind({ step: SecretSetupSteps.draft(), reference: 'secret:B@prod', origin: 'existing' })

    expect(SecretSetupSteps.createdReference(binding)).toBeUndefined()
    expect(SecretSetupSteps.bindSettled({ step: binding, bound: false })).toEqual({ kind: 'draft', error: 'bind' })
  })

  it('keeps a create failure as a draft error and a detected duplicate as a clean draft', () => {
    expect(SecretSetupSteps.createFailed({ step: { kind: 'creating' }, error: 'create' })).toEqual({ kind: 'draft', error: 'create' })
    expect(SecretSetupSteps.createFailed({ step: { kind: 'creating' }, error: null })).toEqual({ kind: 'draft', error: null })
    expect(SecretSetupSteps.createFailed({ step: { kind: 'creating' }, error: 'folder' })).toEqual({ kind: 'draft', error: 'folder' })
    expect(SecretSetupSteps.createFailed({ step: { kind: 'creating' }, error: 'load' })).toEqual({ kind: 'draft', error: 'load' })
    expect(SecretSetupSteps.createFailed({ step: SecretSetupSteps.draft(), error: 'load' })).toEqual({ kind: 'draft', error: 'load' })
    expect(SecretSetupSteps.createFailed({ step: { kind: 'bound', reference: 'secret:E@prod' }, error: 'create' })).toEqual({
      kind: 'bound',
      reference: 'secret:E@prod',
    })
  })

  it('resumes a reopened form on its stored reference instead of a blank draft', () => {
    expect(SecretSetupSteps.restore('secret:C@staging')).toEqual({ kind: 'created', reference: 'secret:C@staging', error: null })
    expect(SecretSetupSteps.restore(undefined)).toEqual({ kind: 'draft', error: null })
    expect(SecretSetupSteps.createSettled({ reference: 'secret:D@prod', bound: true })).toEqual({ kind: 'bound', reference: 'secret:D@prod' })
  })
})
