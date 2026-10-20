import { describe, expect, it } from 'vitest'
import { SecretInputBinding } from './secret-input-bind.js'

describe('secret input binding', () => {
  it('marks an owned field with the attribute the picker watches', () => {
    expect(SecretInputBinding.attributes).toEqual({ 'data-secret-input': 'reference' })
    expect(SecretInputBinding.selector).toBe('[data-secret-input="reference"]')
  })

  it('writes a reference, leaving out the default environment', () => {
    expect(SecretInputBinding.referenceText({ alias: 'TYPESAFE_API_KEY', environment: 'prod' })).toBe('secret:TYPESAFE_API_KEY')
    expect(SecretInputBinding.referenceText({ alias: 'TYPESAFE_API_KEY', environment: 'dev' })).toBe('secret:TYPESAFE_API_KEY@dev')
  })
})
