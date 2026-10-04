import { describe, expect, it } from 'vitest'
import { chooseRemovalTarget, confirmedRemovalTarget, maySubmitValueReplacement, requestValueReplacement } from './secret-mutation-model.js'

describe('Secret Catalog confirmed mutation transitions', () => {
  it('requires a second explicit action before removing an alias or deleting its vault item', () => {
    const initial = { stage: 'choose' } as const
    expect(confirmedRemovalTarget(initial)).toBeNull()

    const aliasConfirmation = chooseRemovalTarget(initial, 'alias')
    expect(aliasConfirmation).toEqual({ stage: 'confirm', target: 'alias' })
    expect(confirmedRemovalTarget(aliasConfirmation)).toBe('alias')

    const vaultConfirmation = chooseRemovalTarget(initial, 'vault-item')
    expect(vaultConfirmation).toEqual({ stage: 'confirm', target: 'vault-item' })
    expect(confirmedRemovalTarget(vaultConfirmation)).toBe('vault-item')
  })

  it('requires a review step before replacing an existing value', () => {
    expect(maySubmitValueReplacement('editing')).toBe(false)
    const confirmationStage = requestValueReplacement('editing')
    expect(confirmationStage).toBe('confirming')
    expect(maySubmitValueReplacement(confirmationStage)).toBe(true)
    expect(requestValueReplacement(confirmationStage)).toBe('editing')
  })
})
