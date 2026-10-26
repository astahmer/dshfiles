import { describe, expect, it } from 'vitest'
import { NetworkPreferencesModel, preferencesSchema } from './network-preferences.js'

describe('network launch preferences', () => {
  it('inherits the native host and port when no preferences are saved', () => {
    expect(NetworkPreferencesModel.startupValues(NetworkPreferencesModel.normalize({}))).toEqual({
      preferences: { lanEnabled: null, bindAddress: null, port: null },
      host: null,
      port: null,
    })
  })

  it('uses native loopback when LAN is explicitly disabled', () => {
    expect(NetworkPreferencesModel.startupValues(NetworkPreferencesModel.normalize({ lanEnabled: false })).host).toBe('127.0.0.1')
  })

  it.each(['192.0.2.10', '2001:db8::10', 'fe80::1%interface'])('accepts a concrete interface address: %s', bindAddress => {
    const startup = NetworkPreferencesModel.startupValues(
      NetworkPreferencesModel.normalize({ lanEnabled: true, bindAddress, port: 0, localhostEnabled: false }),
    )
    expect(startup).toEqual({ host: bindAddress, port: 0, preferences: { lanEnabled: true, bindAddress, port: 0 } })
  })

  it.each([false, true])('discards legacy localhostEnabled=%s without changing LAN/bind/port', localhostEnabled => {
    expect(NetworkPreferencesModel.normalize({ lanEnabled: true, bindAddress: '192.0.2.10', port: 3198, localhostEnabled })).toEqual({
      lanEnabled: true,
      bindAddress: '192.0.2.10',
      port: 3198,
    })
  })

  it('rejects unknown preferences and malformed legacy flags', () => {
    expect(preferencesSchema.safeParse({ arbitrary: true }).success).toBe(false)
    expect(preferencesSchema.safeParse({ localhostEnabled: 'false' }).success).toBe(false)
  })

  it('trims an address before persisting it', () => {
    expect(NetworkPreferencesModel.normalize({ bindAddress: ' 192.0.2.10 ' }).bindAddress).toBe('192.0.2.10')
  })

  it.each(['0.0.0.0', '::', '::ffff:0.0.0.0', 'localhost', 'example.com', '', '127.0.0.1', '127.3.4.5', '::1', '::ffff:127.0.0.1'])(
    'rejects an unsafe or non-literal LAN address: %s',
    bindAddress => {
      expect(preferencesSchema.safeParse({ lanEnabled: true, bindAddress }).success).toBe(false)
    },
  )

  it('requires an address only when LAN is explicitly enabled', () => {
    expect(preferencesSchema.safeParse({ lanEnabled: true }).success).toBe(false)
    expect(preferencesSchema.safeParse({ lanEnabled: true, bindAddress: null }).success).toBe(false)
    expect(preferencesSchema.safeParse({ lanEnabled: null }).success).toBe(true)
    expect(preferencesSchema.safeParse({ lanEnabled: false }).success).toBe(true)
  })

  it.each([-1, 65536, 1.5, '3080'])('rejects an invalid port: %s', port => {
    expect(preferencesSchema.safeParse({ port }).success).toBe(false)
  })

  it('keeps the boot plan detached and immutable', () => {
    const desired = NetworkPreferencesModel.normalize({ lanEnabled: true, bindAddress: '192.0.2.10', port: 3080 })
    const boot = NetworkPreferencesModel.startupValues(desired)
    desired.port = 3198
    desired.bindAddress = '192.0.2.11'
    expect(boot).toMatchObject({ host: '192.0.2.10', port: 3080, preferences: { port: 3080 } })
    expect(Object.isFrozen(boot)).toBe(true)
    expect(Object.isFrozen(boot.preferences)).toBe(true)
  })
})
