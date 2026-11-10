import { describe, expect, it } from 'vitest'
import { ApiDefinitionModel } from '../src/api/define.js'

type DefineModule = typeof import('../src/api/define.js')

/**
 * A Host bundle inlines dshx once, and a contract imported from another plugin's dshx module is built by that module's
 * own copy. Both copies must agree that a registration is a registration, so the marker is shared, not module-local.
 */
describe('a registration made by another dshx copy', () => {
  it('is recognized here and keeps its parts', async () => {
    const otherCopyUrl = new URL('../src/api/define.js?copy=other', import.meta.url).href
    // SAFETY: the query string only forces a second module instance; it is the same module, so its shape is DefineModule.
    const otherCopy = (await import(/* @vite-ignore */ otherCopyUrl)) as DefineModule
    expect(otherCopy.ApiDefinitionModel).not.toBe(ApiDefinitionModel)
    const contract = otherCopy.ApiDefinitionModel.define({
      id: 'cross-copy',
      version: 1,
      owner: '@scope/owner',
      methods: { read: otherCopy.ApiDefinitionModel.method() },
    })
    const registration = contract.host({ read: () => undefined })
    expect(ApiDefinitionModel.isHostRegistration(registration)).toBe(true)
    const parts = ApiDefinitionModel.hostRegistrationParts(registration)
    expect(parts.contract.id).toBe('cross-copy')
    expect(parts.handlers.read).toBeTypeOf('function')
  })
})
