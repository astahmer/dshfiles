import { describe, expect, it } from 'vitest'
import { networkFormSchema, networkSaveSchema, networkSnapshotSchema } from './network-api.js'
import { loopbackAccessStatusSchema } from './api.js'

const binding = { lanEnabled: true, bindAddress: '192.0.2.10', port: 3198 }

describe('required localhost wire compatibility', () => {
  it.each([false, true, undefined])('normalizes old Host saved localhostEnabled=%s to true without changing LAN settings', localhostEnabled => {
    expect(networkFormSchema.parse({ ...binding, localhostEnabled })).toEqual({ ...binding, localhostEnabled: true })
  })

  it.each([false, true])('rejects a disable save with LAN enabled=%s', lanEnabled => {
    expect(networkSaveSchema.safeParse({ ...binding, lanEnabled, localhostEnabled: false, expectedRevision: 0 }).success).toBe(false)
  })

  it('accepts an explicit true or omitted compatibility flag', () => {
    expect(networkSaveSchema.parse({ ...binding, expectedRevision: 0 })).toEqual({ ...binding, localhostEnabled: true, expectedRevision: 0 })
    expect(networkSaveSchema.parse({ ...binding, localhostEnabled: true, expectedRevision: 1 }).localhostEnabled).toBe(true)
  })

  it('preserves old Host actual unavailability and disabled status', () => {
    const snapshot = networkSnapshotSchema.parse({
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
    expect(loopbackAccessStatusSchema.parse({ state: 'disabled', upstreamOrigin: null, localhostOrigin: null, listeners: [] }).state).toBe('disabled')
  })

  it('still rejects arbitrary unknown form and save fields', () => {
    expect(networkFormSchema.safeParse({ ...binding, arbitrary: true }).success).toBe(false)
    expect(networkSaveSchema.safeParse({ ...binding, expectedRevision: 0, arbitrary: true }).success).toBe(false)
  })
})
