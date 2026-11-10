import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'
import { pairingOfferSchema, phonePairingApi } from '../src/api.ts'

const decode = Schema.decodeUnknownSync(pairingOfferSchema)

describe('phone pairing offer contract', () => {
  it('serves one single-use offer to the sidebar popover and reports disabled phone access', () => {
    expect(phonePairingApi.methods.offer).toBeDefined()
    expect(decode({ state: 'off' })).toEqual({ state: 'off' })
    const ready = {
      state: 'ready',
      payload: 'https://phone.example/pair#id=offer&secret=secret',
      code: '123456',
      expiresAt: 1_800_000_000_000,
      origin: 'https://phone.example',
    }
    expect(decode(ready)).toEqual(ready)
  })

  it('rejects a code the pairing page could never accept', () => {
    const ready = { state: 'ready', payload: 'https://phone.example/pair', code: '12345', expiresAt: 1, origin: 'https://phone.example' }
    expect(() => decode(ready)).toThrow()
    expect(() => decode({ state: 'ready', payload: 'https://phone.example/pair', code: '123456', origin: 'https://phone.example' })).toThrow()
  })
})
