import { describe, expect, it } from 'vitest'
import { loopbackAccessApi } from './api.js'

describe('Network access agent parity', () => {
  it('exposes the same status, settings read and staged save used by the GUI', () => {
    expect(
      Object.values(loopbackAccessApi.methods)
        .map(method => method.tool?.name)
        .sort(),
    ).toEqual(['loopback_access_status', 'network_access_save', 'network_access_settings'])
    expect(loopbackAccessApi.methods.status.tool?.readOnly).toBe(true)
    expect(loopbackAccessApi.methods.network.tool?.readOnly).toBe(true)
    expect(loopbackAccessApi.methods.saveNetwork.tool?.readOnly).toBe(false)
    expect(loopbackAccessApi.methods.saveNetwork.description).toContain('only when the user asks')
    expect(loopbackAccessApi.methods.saveNetwork.description).toContain('without restarting or rebinding')
  })
})
