import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { decodeNetworkSnapshot, networkFormSchema, networkSaveSchema } from './network-api.js'
import { loopbackAccessStatusSchema } from './api.js'

const binding = { lanEnabled: true, bindAddress: '192.0.2.10', port: 3198 }
const decodes = (schema: Parameters<typeof Schema.decodeUnknownResult>[0], value: unknown): boolean =>
  Schema.decodeUnknownResult(schema, { onExcessProperty: 'error' })(value)._tag === 'Success'
const decode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown): S['Type'] => Schema.decodeUnknownSync(schema)(value)

describe('required localhost wire compatibility', () => {
  it.each([false, true, undefined])('normalizes old Host saved localhostEnabled=%s to true without changing LAN settings', localhostEnabled => {
    expect(decode(networkFormSchema, { ...binding, localhostEnabled })).toEqual({ ...binding, localhostEnabled: true })
  })

  it.each([false, true])('rejects a disable save with LAN enabled=%s', lanEnabled => {
    expect(decodes(networkSaveSchema, { ...binding, lanEnabled, localhostEnabled: false, expectedRevision: 0 })).toBe(false)
  })

  it('accepts an explicit true or omitted compatibility flag', () => {
    expect(decode(networkSaveSchema, { ...binding, expectedRevision: 0 })).toEqual({ ...binding, localhostEnabled: true, expectedRevision: 0 })
    expect(decode(networkSaveSchema, { ...binding, localhostEnabled: true, expectedRevision: 1 }).localhostEnabled).toBe(true)
  })

  it('preserves old Host actual unavailability and disabled status', () => {
    const snapshot = decodeNetworkSnapshot({
      revision: 0,
      writable: true,
      saved: { ...binding, localhostEnabled: false },
      active: { host: binding.bindAddress, port: binding.port, localhostEnabled: false, urls: ['http://192.0.2.10:3198'] },
      addresses: [],
      cliOverrides: { host: null, port: null },
      pendingRestart: false,
      integration: 'managed',
      unavailableReason: null,
    })
    expect(snapshot.saved.localhostEnabled).toBe(true)
    expect(snapshot.active.localhostEnabled).toBe(false)
    expect(decode(loopbackAccessStatusSchema, { state: 'disabled', upstreamOrigin: null, localhostOrigin: null, listeners: [] }).state).toBe('disabled')
  })

  it('still rejects arbitrary unknown form and save fields', () => {
    expect(decodes(networkFormSchema, { ...binding, arbitrary: true })).toBe(false)
    expect(decodes(networkSaveSchema, { ...binding, expectedRevision: 0, arbitrary: true })).toBe(false)
  })
})
