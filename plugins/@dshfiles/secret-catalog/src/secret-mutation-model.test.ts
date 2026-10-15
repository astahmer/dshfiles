import { describe, expect, it } from 'vitest'
import { SecretMutationRules } from './secret-mutation-model.js'

describe('Secret Catalog confirmed mutation transitions', () => {
  it('requires a second explicit action before removing an alias or deleting its vault item', () => {
    const initial = { stage: 'choose' } as const
    expect(SecretMutationRules.confirmedRemovalTarget(initial)).toBeNull()

    const aliasConfirmation = SecretMutationRules.chooseRemovalTarget(initial, 'alias')
    expect(aliasConfirmation).toEqual({ stage: 'confirm', target: 'alias' })
    expect(SecretMutationRules.confirmedRemovalTarget(aliasConfirmation)).toBe('alias')

    const vaultConfirmation = SecretMutationRules.chooseRemovalTarget(initial, 'vault-item')
    expect(vaultConfirmation).toEqual({ stage: 'confirm', target: 'vault-item' })
    expect(SecretMutationRules.confirmedRemovalTarget(vaultConfirmation)).toBe('vault-item')
  })

  it('requires a review step before replacing an existing value', () => {
    expect(SecretMutationRules.maySubmitValueReplacement('editing')).toBe(false)
    const confirmationStage = SecretMutationRules.requestValueReplacement('editing')
    expect(confirmationStage).toBe('confirming')
    expect(SecretMutationRules.maySubmitValueReplacement(confirmationStage)).toBe(true)
    expect(SecretMutationRules.requestValueReplacement(confirmationStage)).toBe('editing')
  })
})
